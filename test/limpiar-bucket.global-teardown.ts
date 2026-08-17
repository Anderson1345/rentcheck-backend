import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

export default async (): Promise<void> => {
  config({ path: '.env.test', override: true });

  const prefijo = (process.env.SUPABASE_PREFIJO_RUTA ?? '').trim();
  if (!prefijo) {
    console.warn(
      '[global-teardown] SUPABASE_PREFIJO_RUTA vacío; no se limpia el bucket.',
    );
    return;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_BUCKET;
  if (!url || !serviceRoleKey || !bucket) {
    console.warn(
      '[global-teardown] Faltan credenciales de Supabase; no se limpia el bucket.',
    );
    return;
  }

  const supabase = createClient(url, serviceRoleKey);

  const listarRecursivo = async (
    ruta: string,
  ): Promise<{ archivos: string[]; carpetas: string[] }> => {
    const { data, error } = await supabase.storage.from(bucket).list(ruta);
    if (error) {
      throw new Error(`list('${ruta}') -> ${error.message}`);
    }
    const archivos: string[] = [];
    const carpetas: string[] = [];
    for (const item of data ?? []) {
      const sub = `${ruta}/${item.name}`;
      if (item.metadata === null) {
        const hijo = await listarRecursivo(sub);
        archivos.push(...hijo.archivos);
        carpetas.push(sub, ...hijo.carpetas);
      } else {
        archivos.push(sub);
      }
    }
    return { archivos, carpetas };
  };

  const { data: carpetas, error: errorListado } = await supabase.storage
    .from(bucket)
    .list(prefijo);
  if (errorListado) {
    throw new Error(`list('${prefijo}') -> ${errorListado.message}`);
  }

  let total = 0;
  for (const item of carpetas ?? []) {
    const ruta = `${prefijo}${item.name}`;
    if (item.metadata === null) {
      const contenido = await listarRecursivo(ruta);
      for (let i = 0; i < contenido.archivos.length; i += 900) {
        const { error } = await supabase.storage
          .from(bucket)
          .remove(contenido.archivos.slice(i, i + 900));
        if (error) {
          throw new Error(`remove -> ${error.message}`);
        }
      }
      const carpetasVacias = [ruta, ...contenido.carpetas];
      for (let i = 0; i < carpetasVacias.length; i += 900) {
        const { error } = await supabase.storage
          .from(bucket)
          .remove(carpetasVacias.slice(i, i + 900));
        if (error) {
          throw new Error(`remove -> ${error.message}`);
        }
      }
      total += contenido.archivos.length;
    } else {
      const { error } = await supabase.storage.from(bucket).remove([ruta]);
      if (error) {
        throw new Error(`remove -> ${error.message}`);
      }
      total += 1;
    }
  }

  console.log(
    `[global-teardown] Bucket limpio bajo '${prefijo}' (${total} archivos).`,
  );
};
