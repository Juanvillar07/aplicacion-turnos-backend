import { Global, Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

/** Cliente de WhatsApp (envío y registro). El bot vive en WhatsappBotModule. */
@Global()
@Module({
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
