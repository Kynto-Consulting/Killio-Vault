import { api } from './http';

/**
 * Payment links (Stripe / PayPal / MercadoPago checkout) — powers the payment
 * brick. Mirrors the web frontend `@/lib/api/payments` contract: the backend
 * `/payments/links` route is the same one the web app consumes, so the request
 * and response shapes are identical.
 *
 * The Vault axios interceptor injects the bearer token automatically, so the
 * `accessToken` argument is accepted for source-parity with the web file but
 * ignored here.
 */

export interface CreatePaymentLinkPayload {
  cardId?: string;
  brickId?: string;
  title: string;
  description?: string;
  amount: number;
  currency: string;
  provider: 'stripe' | 'paypal' | 'mercadopago';
  connectionId?: string;
}

export interface PaymentLink {
  checkoutUrl: string;
  externalProductId?: string | null;
}

export async function createPaymentLink(
  payload: CreatePaymentLinkPayload,
  _accessToken?: string,
): Promise<PaymentLink> {
  const { data } = await api.post<PaymentLink>('/payments/links', payload);
  return data;
}
