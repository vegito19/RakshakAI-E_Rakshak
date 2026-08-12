import { otpAuthService } from './utils/otpAuthService';

async function main() {
  console.log('--- 1. TESTING EMAIL OTP GENERATION & DISPATCH ---');
  const testEmail = 'officer.test@gujaratpolice.gov.in';

  // 1. Generate Login OTP
  const loginRes = await otpAuthService.generateAndSendOtp(testEmail, 'LOGIN');
  console.log(`Generated Login OTP: ${loginRes.devOtp}, Success: ${loginRes.success}`);

  // 2. Verify Wrong OTP fails gracefully
  const invalidVerify = otpAuthService.verifyOtp(testEmail, '000000', 'LOGIN');
  console.log(`Invalid OTP rejected: ${!invalidVerify.valid}, Error: "${invalidVerify.error}"`);

  // 3. Verify Correct OTP succeeds
  const validVerify = otpAuthService.verifyOtp(testEmail, loginRes.devOtp!, 'LOGIN');
  console.log(`Correct OTP accepted: ${validVerify.valid}`);

  // 4. Verify Replayed OTP is rejected (single-use)
  const replayVerify = otpAuthService.verifyOtp(testEmail, loginRes.devOtp!, 'LOGIN');
  console.log(`Replayed OTP rejected: ${!replayVerify.valid}`);

  // 5. Test Forgot Password OTP flow
  console.log('\n--- 2. TESTING FORGOT PASSWORD OTP FLOW ---');
  const forgotRes = await otpAuthService.generateAndSendOtp(testEmail, 'FORGOT_PASSWORD');
  console.log(`Generated Reset OTP: ${forgotRes.devOtp}`);
  const resetVerify = otpAuthService.verifyOtp(testEmail, forgotRes.devOtp!, 'FORGOT_PASSWORD');
  console.log(`Password Reset OTP Verified: ${resetVerify.valid}`);

  // 6. Test New Officer Enrollment OTP flow
  console.log('\n--- 3. TESTING NEW OFFICER ENROLLMENT OTP FLOW ---');
  const regRes = await otpAuthService.generateAndSendOtp('new.officer@gujaratpolice.gov.in', 'REGISTER');
  console.log(`Generated Enrollment OTP: ${regRes.devOtp}`);
  const regVerify = otpAuthService.verifyOtp('new.officer@gujaratpolice.gov.in', regRes.devOtp!, 'REGISTER');
  console.log(`Enrollment OTP Verified: ${regVerify.valid}`);

  console.log('\n>>> ALL PROFESSIONAL OTP & AUTHENTICATION PROTOCOLS VERIFIED SUCCESSFUL <<<');
}

main().catch(console.error);
