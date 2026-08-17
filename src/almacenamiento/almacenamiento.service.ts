import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger(AlmacenamientoService.name);
  private readonly supabase: ReturnType<typeof createClient>;
  private readonly bucket: string;
  private readonly prefijoRuta: string;

  constructor(configService: ConfigService) {
    const url = configService.getOrThrow<string>('SUPABASE_URL');
    const serviceRoleKey = configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    this.bucket = configService.getOrThrow<string>('SUPABASE_BUCKET');
    this.prefijoRuta =
      configService.get<string>('SUPABASE_PREFIJO_RUTA', '') ?? '';
    this.supabase = createClient(url, serviceRoleKey);
  }

  private conPrefijo(ruta: string): string {
    const prefijo = this.prefijoRuta.trim().replace(/^\/+|\/+$/g, '');
    if (!prefijo) {
      return ruta;
    }
    return `${prefijo}/${ruta.replace(/^\/+/, '')}`;
  }

  async subirArchivo(
    buffer: Buffer,
    rutaDestino: string,
    tipoMime: string,
    sobrescribir = false,
  ): Promise<string> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(this.conPrefijo(rutaDestino), buffer, {
        contentType: tipoMime,
        upsert: sobrescribir,
      });

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
      .createSignedUrl(this.conPrefijo(ruta), expiracionSegundos ?? 3600);

    if (error) {
      this.logger.error(
        `Error al generar URL firmada para '${ruta}': ${error.message}`,
      );
      throw new Error(`No se pudo generar la URL firmada: ${error.message}`);
    }

    return data.signedUrl;
  }

  async descargarArchivo(ruta: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .download(this.conPrefijo(ruta));

    if (error) {
      this.logger.error(
        `Error al descargar archivo '${ruta}': ${error.message}`,
      );
      throw new Error(`No se pudo descargar el archivo: ${error.message}`);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  async eliminarArchivo(ruta: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([this.conPrefijo(ruta)]);

    if (error) {
      this.logger.error(
        `Error al eliminar archivo '${ruta}': ${error.message}`,
      );
      throw new Error(`No se pudo eliminar el archivo: ${error.message}`);
    }
  }

  async listar(
    ruta: string,
  ): Promise<Array<{ name: string; esCarpeta: boolean }>> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .list(this.conPrefijo(ruta));

    if (error) {
      this.logger.error(`Error al listar '${ruta}': ${error.message}`);
      throw new Error(`No se pudo listar la ruta: ${error.message}`);
    }

    return (data ?? []).map((item) => ({
      name: item.name,
      esCarpeta: item.metadata === null,
    }));
  }
}
