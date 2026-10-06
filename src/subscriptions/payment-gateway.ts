import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { randomBytes } from 'crypto';

export interface ChargeRequest {
  /** Valor en COP */
  amount: number;
  description: string;
  cardBrand: string;
  cardLast4: string;
  holderName: string;
}

export interface ChargeResult {
  approved: boolean;
  provider: PaymentProvider;
  /** Referencia de la transacción en la pasarela */
  reference: string;
  /** Motivo legible del rechazo */
  failureReason?: string;
}

/**
 * Cobro de una suscripción. Hoy lo implementa `SimulatedGateway`; cuando haya
 * pasarela (Wompi) basta con otra implementación de esta interfaz.
 */
export abstract class PaymentGateway {
  abstract charge(request: ChargeRequest): Promise<ChargeResult>;
}

/** Últimos 4 dígitos de la tarjeta de prueba que siempre se rechaza (4000 0000 0000 0002) */
export const DECLINED_TEST_CARD_LAST4 = '0002';

/** Pasarela de prueba: no cobra nada. Aprueba todo salvo la tarjeta de rechazo. */
@Injectable()
export class SimulatedGateway extends PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeResult> {
    const reference = `SIM-${randomBytes(8).toString('hex').toUpperCase()}`;
    if (request.cardLast4 === DECLINED_TEST_CARD_LAST4) {
      return Promise.resolve({
        approved: false,
        provider: PaymentProvider.SIMULATED,
        reference,
        failureReason: 'Tu banco rechazó el pago. Prueba con otra tarjeta.',
      });
    }
    return Promise.resolve({
      approved: true,
      provider: PaymentProvider.SIMULATED,
      reference,
    });
  }
}
