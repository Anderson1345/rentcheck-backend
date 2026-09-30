import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInquilinoDto } from './dto/crear-inquilino.dto';
import { normalizarYValidarDatosInquilino } from '../common/utils/normalizar-cedula';

/**
 * Lo que el arrendador ve de una persona: los datos que ÉL escribió (la copia
 * del contrato o, en una ficha suelta legada, los de la ficha). El correo solo
 * se muestra si su contrato más reciente ya está vinculado (la persona lo dio
 * al crear su cuenta con ese código); nunca nada más del perfil global.
 */
export interface InquilinoSeguro {
  id: string;
  nombre: string;
  cedula: string;
  telefono: string;
  correo: string | null;
  vinculado: boolean;
  creado_en: Date;
}

const SELECT_FICHA_PROPIA = {
  id: true,
  nombre: true,
  cedula: true,
  telefono: true,
  creado_en: true,
} as const;

@Injectable()
export class InquilinoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Correos (select explícito) de las identidades dadas. */
  private async correosPorIdentidad(ids: string[]) {
    if (ids.length === 0) {
      return new Map<string, string | null>();
    }
    const filas = await this.prisma.inquilino.findMany({
      where: { id: { in: ids } },
      select: { id: true, correo: true },
    });
    return new Map(filas.map((fila) => [fila.id, fila.correo]));
  }

  /**
   * Personas con las que el arrendador tiene contrato (una fila por persona,
   * con la copia de su contrato más reciente) más las fichas propias de
   * `POST /inquilinos` (obsoleto) que aún no tienen contrato.
   */
  async listar(arrendadorId: string): Promise<InquilinoSeguro[]> {
    const contratos = await this.prisma.contrato.findMany({
      where: { arrendador_id: arrendadorId },
      orderBy: { creado_en: 'desc' },
      select: {
        inquilino_id: true,
        inquilino_nombre: true,
        inquilino_cedula: true,
        inquilino_telefono: true,
        vinculado_en: true,
        creado_en: true,
      },
    });

    const personas = new Map<string, InquilinoSeguro>();
    for (const contrato of contratos) {
      const existente = personas.get(contrato.inquilino_id);
      if (existente) {
        // Los contratos vienen del más reciente al más antiguo: la fila
        // conserva la copia (y el estado de vinculación) del último y la
        // fecha del primero.
        existente.creado_en = contrato.creado_en;
        continue;
      }
      personas.set(contrato.inquilino_id, {
        id: contrato.inquilino_id,
        nombre: contrato.inquilino_nombre,
        cedula: contrato.inquilino_cedula,
        telefono: contrato.inquilino_telefono,
        correo: null,
        vinculado: contrato.vinculado_en !== null,
        creado_en: contrato.creado_en,
      });
    }

    const correos = await this.correosPorIdentidad(
      [...personas.values()].filter((p) => p.vinculado).map((p) => p.id),
    );
    for (const persona of personas.values()) {
      persona.correo = persona.vinculado
        ? (correos.get(persona.id) ?? null)
        : null;
    }

    const fichasSinContrato = await this.prisma.inquilino.findMany({
      where: {
        arrendador_id: arrendadorId,
        id: { notIn: [...personas.keys()] },
      },
      select: SELECT_FICHA_PROPIA,
    });

    return [
      ...personas.values(),
      ...fichasSinContrato.map((ficha) => ({
        ...ficha,
        correo: null,
        vinculado: false,
      })),
    ].sort((a, b) => b.creado_en.getTime() - a.creado_en.getTime());
  }

  async encontrarUno(
    id: string,
    arrendadorId: string,
  ): Promise<InquilinoSeguro | null> {
    const contratos = await this.prisma.contrato.findMany({
      where: { arrendador_id: arrendadorId, inquilino_id: id },
      orderBy: { creado_en: 'desc' },
      select: {
        inquilino_nombre: true,
        inquilino_cedula: true,
        inquilino_telefono: true,
        vinculado_en: true,
        creado_en: true,
      },
    });
    if (contratos.length > 0) {
      const vinculado = contratos[0].vinculado_en !== null;
      const correo = vinculado
        ? ((await this.correosPorIdentidad([id])).get(id) ?? null)
        : null;
      return {
        id,
        nombre: contratos[0].inquilino_nombre,
        cedula: contratos[0].inquilino_cedula,
        telefono: contratos[0].inquilino_telefono,
        correo,
        vinculado,
        creado_en: contratos[contratos.length - 1].creado_en,
      };
    }
    const ficha = await this.prisma.inquilino.findFirst({
      where: { id, arrendador_id: arrendadorId },
      select: SELECT_FICHA_PROPIA,
    });
    return ficha ? { ...ficha, correo: null, vinculado: false } : null;
  }

  /** Obsoleto: `POST /contratos` crea la identidad con `inquilino_nuevo`. */
  async crear(
    dto: CrearInquilinoDto,
    arrendadorId: string,
  ): Promise<InquilinoSeguro> {
    const datos = normalizarYValidarDatosInquilino(dto);
    const ficha = await this.prisma.inquilino.create({
      data: {
        arrendador_id: arrendadorId,
        nombre: datos.nombre,
        cedula: datos.cedula,
        telefono: datos.telefono,
      },
      select: SELECT_FICHA_PROPIA,
    });
    return { ...ficha, correo: null, vinculado: false };
  }
}
