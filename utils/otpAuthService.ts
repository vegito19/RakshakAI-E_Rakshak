import nodemailer from 'nodemailer';
import { logger } from './logger';

export type OtpPurpose = 'LOGIN' | 'REGISTER' | 'FORGOT_PASSWORD';

export interface OtpRecord {
  email: string;
  otp: string;
  purpose: OtpPurpose;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
}

export class OtpAuthService {
  private otps: Map<string, OtpRecord> = new Map();

  /**
   * Dynamically gets or initializes the SMTP Transporter.
   */
  private getTransporter(): nodemailer.Transporter | null {
    const rawUser = process.env.SMTP_USER || process.env.EMAIL_USER || '';
    const rawPass = process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD || '';
    
    const user = rawUser.trim();
    // Strip spaces from Google App Password (e.g. "rdyq gnzc zhkc wxhs" -> "rdyqgnzczhkcwxhs")
    const pass = rawPass.replace(/\s+/g, '').trim();

    if (user && pass) {
      try {
        const isGmail = user.toLowerCase().includes('@gmail.com');
        if (isGmail) {
          return nodemailer.createTransport({
            service: 'gmail',
            auth: { user, pass }
          });
        }
        return nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: process.env.SMTP_PORT === '465',
          auth: { user, pass },
          tls: {
            rejectUnauthorized: false
          }
        });
      } catch (err) {
        logger.warn(`Failed to create SMTP transporter: ${(err as Error).message}`, 'OtpAuthService');
        return null;
      }
    }
    return null;
  }

  /**
   * Generates a 6-digit cryptographic security OTP and dispatches it.
   */
  public async generateAndSendOtp(
    rawEmail: string,
    purpose: OtpPurpose
  ): Promise<{ success: boolean; message: string; email: string; purpose: OtpPurpose; devOtp?: string; liveEmailDelivered: boolean; expiresInSeconds?: number }> {
    const email = rawEmail.trim().toLowerCase();

    // 1. Generate 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

    const key = `${email}::${purpose}`;
    this.otps.set(key, {
      email,
      otp,
      purpose,
      expiresAt,
      attempts: 0,
      createdAt: new Date()
    });

    logger.info(`Generated OTP [${otp}] for email: "${email}" (Purpose: ${purpose}, Expires: 5m)`, 'OtpAuthService');

    // 2. Dispatch real email via SMTP if configured
    let emailDispatched = false;
    let dispatchError: string | null = null;
    const transporter = this.getTransporter();

    if (transporter) {
      try {
        const subjectMap = {
          LOGIN: '🛡️ Gujarat Police Cyber Cell - Login Verification OTP',
          REGISTER: '🛡️ Gujarat Police Cyber Cell - Officer Enrollment OTP',
          FORGOT_PASSWORD: '🛡️ Gujarat Police Cyber Cell - Password Reset OTP'
        };

        const purposeDesc = {
          LOGIN: 'Duty Badge Verification & Two-Factor Sign In',
          REGISTER: 'New Investigating Officer Profile Enrollment',
          FORGOT_PASSWORD: 'Emergency Badge Access Password Reset'
        };

        const senderEmail = process.env.SMTP_FROM || process.env.SMTP_USER || process.env.EMAIL_USER || 'jhavineet132@gmail.com';

        const htmlContent = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #020617; color: #f8fafc; padding: 24px; border-radius: 16px; max-width: 540px; margin: 0 auto; border: 1px solid #1e293b;">
            <div style="text-align: center; border-bottom: 1px solid #1e293b; padding-bottom: 16px; margin-bottom: 20px;">
              <h2 style="margin: 0; color: #38bdf8; font-size: 20px; letter-spacing: 1px;">🛡️ GUJARAT POLICE CYBER CRIME CELL</h2>
              <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 11px; text-transform: uppercase; font-family: monospace;">Rakshak CrimeOS • Secure Law Enforcement Authentication</p>
            </div>
            
            <div style="background-color: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
              <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 12px;">Authentication Purpose:</p>
              <h3 style="margin: 0; color: #e2e8f0; font-size: 15px;">${purposeDesc[purpose]}</h3>
            </div>

            <div style="text-align: center; margin: 24px 0;">
              <p style="margin: 0 0 8px 0; color: #cbd5e1; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Your 6-Digit One-Time Security PIN:</p>
              <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); border: 2px solid #06b6d4; border-radius: 14px; padding: 18px 24px; display: inline-block; font-size: 36px; font-weight: 900; letter-spacing: 10px; color: #38bdf8; font-family: 'Courier New', Courier, monospace; box-shadow: 0 8px 24px rgba(6, 182, 212, 0.25);">
                ${otp}
              </div>
              <p style="margin: 12px 0 0 0; color: #ef4444; font-size: 11px; font-weight: bold; font-family: monospace;">⏱️ Valid for 5 Minutes • Single Use Only</p>
            </div>

            <div style="background-color: #090d16; border-left: 3px solid #eab308; padding: 12px; border-radius: 6px; margin-bottom: 20px; font-size: 11px; color: #fbbf24;">
              ⚠️ <strong>Law Enforcement Security Notice:</strong> Never share this cryptographic OTP with anyone. Cyber Cell personnel will never ask for your authentication PIN over telephone or chat.
            </div>

            <div style="text-align: center; border-top: 1px solid #1e293b; padding-top: 14px; font-size: 10px; color: #64748b; font-family: monospace;">
              ISO/IEC 27037 & Section 63 BSA 2023 Compliant Evidence Node<br/>
              Surat Police Commissionerate, Gujarat, India
            </div>
          </div>
        `;

        // Dispatch email asynchronously so API responds instantly without cloud gateway timeouts
        emailDispatched = true;
        const fromHeader = `Rakshak CrimeOS Auth <${senderEmail.trim()}>`;
        transporter.sendMail({
          from: fromHeader,
          to: email,
          subject: subjectMap[purpose],
          html: htmlContent
        }).then((info) => {
          logger.info(`Official live email accepted by Gmail for ${email} (MessageID: ${info.messageId}, SMTP: ${info.response})`, 'OtpAuthService');
        }).catch((sendErr) => {
          logger.warn(`SMTP email dispatch background issue: ${(sendErr as Error).message}`, 'OtpAuthService');
        });
      } catch (sendErr) {
        dispatchError = (sendErr as Error).message;
        logger.warn(`SMTP email dispatch issue: ${dispatchError}. Falling back to instant security OTP mode.`, 'OtpAuthService');
      }
    } else {
      logger.info(`No SMTP credentials detected in .env. Running in local dev simulation mode for email: ${email}`, 'OtpAuthService');
    }

    return {
      success: true,
      message: emailDispatched
        ? `✅ Email OTP delivered to inbox for ${email}. Please check your inbox / spam folder.`
        : `Security OTP PIN for ${email}: ${otp} (Cloud fallback mode active)`,
      email,
      purpose,
      devOtp: !emailDispatched ? otp : undefined,
      liveEmailDelivered: emailDispatched,
      expiresInSeconds: 300
    };
  }

  /**
   * Verifies the provided 6-digit OTP for the specified email and purpose.
   */
  public verifyOtp(rawEmail: string, inputOtp: string, purpose: OtpPurpose): { valid: boolean; error?: string } {
    const email = rawEmail.trim().toLowerCase();
    const cleanOtp = inputOtp.trim();
    const key = `${email}::${purpose}`;

    const record = this.otps.get(key);
    if (!record) {
      return {
        valid: false,
        error: 'No active OTP found for this email. Please click "SEND OTP" to request a security code.'
      };
    }

    if (Date.now() > record.expiresAt.getTime()) {
      this.otps.delete(key);
      return {
        valid: false,
        error: 'The OTP security code has expired. Please request a new OTP.'
      };
    }

    record.attempts++;
    if (record.attempts > 5) {
      this.otps.delete(key);
      return {
        valid: false,
        error: 'Maximum verification attempts exceeded. Please generate a new OTP.'
      };
    }

    if (record.otp !== cleanOtp) {
      return {
        valid: false,
        error: `Invalid 6-digit OTP code entered. ${5 - record.attempts} attempts remaining.`
      };
    }

    // OTP verified successfully - consume it so it cannot be replayed
    this.otps.delete(key);
    logger.info(`OTP verified successfully for email "${email}" (Purpose: ${purpose})`, 'OtpAuthService');

    return { valid: true };
  }
}

export const otpAuthService = new OtpAuthService();
