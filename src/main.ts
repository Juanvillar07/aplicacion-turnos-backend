import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { UPLOADS_DIR } from './storage/local-disk.storage';

async function bootstrap() {
  // rawBody: necesario para verificar la firma de los webhooks de WhatsApp
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  // Logos y fotos subidos (almacenamiento local). Nombres únicos: caché larga.
  app.useStaticAssets(UPLOADS_DIR, {
    prefix: '/uploads/',
    maxAge: '30d',
    immutable: true,
    index: false,
  });
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL', 'http://localhost:5173'),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(config.get<number>('PORT', 3000));
}
void bootstrap();
