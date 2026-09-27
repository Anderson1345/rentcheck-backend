import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configurarApp } from './configurar-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configurarApp(app);

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
