import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger(AlmacenamientoService.name);
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;

  constructor(configService: ConfigService) {
    const url = configService.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    this.bucket = configService.getOrThrow<string>('SUPABASE_BUCKET');
    this.supabase = createClient(url, serviceRoleKey);
  }

  async subirArchivo(
    buffer: Buffer,
    rutaDestino: string,
    tipoMime: string,
  ): Promise<string> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(rutaDestino, buffer, { contentType: tipoMime });

    if (error) {
      this.logger.error(
        `Error al subir archivo a '${rutaDestino}': ${error.message}`,
      );
      throw new Error(`No se pudo subir el archivo: ${error.message}`);
    }

    return rutaDestino;
  }

  async generarUrlFirmada(
    ruta: string,
    expiracionSegundos?: number,
  ): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(ruta, expiracionSegundos ?? 3600);

    if (error) {
      this.logger.error(
        `Error al generar URL firmada para '${ruta}': ${error.message}`,
      );
      throw new Error(`No se pudo generar la URL firmada: ${error.message}`);
    }

    return data.signedUrl;
  }

  async eliminarArchivo(ruta: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([ruta]);

    if (error) {
      this.logger.error(
        `Error al eliminar archivo '${ruta}': ${error.message}`,
      );
      throw new Error(`No se pudo eliminar el archivo: ${error.message}`);
    }
  }
}