import { URL } from 'url';
export declare function validateSsrfUrl(urlString: string): Promise<URL>;
export declare function safeFetch(url: string, init?: RequestInit, maxRedirects?: number): Promise<Response>;
