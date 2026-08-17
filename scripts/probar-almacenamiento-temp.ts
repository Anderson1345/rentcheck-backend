import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';

async function probar() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const almacenamiento = app.get(AlmacenamientoService);

  const buffer = Buffer.from('Archivo de prueba RentCheck - almacenamiento');
  const ruta = 'prueba-temp/archivo-prueba.txt';
  const tipoMime = 'text/plain';

  console.log('=== SUBIR ARCHIVO ===');
  const rutaSubida = await almacenamiento.subirArchivo(buffer, ruta, tipoMime);
  console.log('Ruta (key):', rutaSubida);

  console.log('\n=== GENERAR URL FIRMADA ===');
  const url = await almacenamiento.generarUrlFirmada(ruta, 3600);
  console.log('URL firmada:', url);

  console.log('\n=== ELIMINAR ARCHIVO ===');
  await almacenamiento.eliminarArchivo(ruta);
  console.log('Archivo eliminado correctamente');

  await app.close();
}

probar().catch((error) => {
  console.error('ERROR:', error);
  process.exit(1);
});