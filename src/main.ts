import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const esLocalhost = /^https?:\/\/localhost(:\d+)?$/.test(origin);
      const esVercel = /(^|\.)vercel\.app$/.test(origin);
      callback(null, esLocalhost || esVercel);
    },
    credentials: false,
  });

  const config = new DocumentBuilder()
    .setTitle('RentCheck API')
    .setDescription('Documentación de la API de RentCheck')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api-json',
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
