import { logger } from '../../utils/logger';

export class ProxyRotator {
  private proxies: string[] = [];
  private currentIndex = 0;

  constructor() {
    this.reloadProxies();
  }

  /**
   * Reads environment proxy configuration and splits it.
   */
  public reloadProxies(): void {
    const envProxy = process.env.PROXY_SERVER;
    if (envProxy) {
      this.proxies = envProxy
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      
      if (this.proxies.length > 0) {
        logger.info(`ProxyRotator: Loaded ${this.proxies.length} proxy/proxies for rotation.`, 'ProxyRotator');
      }
    } else {
      this.proxies = [];
    }
  }

  /**
   * Returns the next proxy configuration object in round-robin sequence.
   */
  public getNextProxy(): any | null {
    if (this.proxies.length === 0) return null;

    const proxyStr = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;

    try {
      const url = new URL(proxyStr);
      const proxyConfig: any = {
        server: `${url.protocol}//${url.host}`
      };
      if (url.username) {
        proxyConfig.username = decodeURIComponent(url.username);
      }
      if (url.password) {
        proxyConfig.password = decodeURIComponent(url.password);
      }
      return proxyConfig;
    } catch (err) {
      // Fallback for simple hosts
      return {
        server: proxyStr
      };
    }
  }
}

export const proxyRotator = new ProxyRotator();
