import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInquilinoDto } from './dto/crear-inquilino.dto';
import { normalizarYValidarDatosInquilino } from '../common/utils/normalizar-cedula';

/**
 * Lo que el arrendador ve de una persona: los datos que ÉL escribió (la copia
 * del contrato o, en una ficha suelta legada, los de la ficha). Nunca el
 * correo ni nada del perfil global.
 */
export interface InquilinoSeguro {
  id: string;
  nombre: string;
  cedula: string;
  telefono: string;
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
        creado_en: true,
      },
    });

    const personas = new Map<string, InquilinoSeguro>();
    for (const contrato of contratos) {
      const existente = personas.get(contrato.inquilino_id);
      if (existente) {
        // Los contratos vienen del más reciente al más antiguo: la fila
        // conserva la copia del último y la fecha del primero.
        existente.creado_en = contrato.creado_en;
        continue;
      }
      personas.set(contrato.inquilino_id, {
        id: contrato.inquilino_id,
        nombre: contrato.inquilino_nombre,
        cedula: contrato.inquilino_cedula,
        telefono: contrato.inquilino_telefono,
        creado_en: contrato.creado_en,
      });
    }

    const fichasSinContrato = await this.prisma.inquilino.findMany({
      where: {
        arrendador_id: arrendadorId,
        id: { notIn: [...personas.keys()] },
      },
      select: SELECT_FICHA_PROPIA,
    });

    return [...personas.values(), ...fichasSinContrato].sort(
      (a, b) => b.creado_en.getTime() - a.creado_en.getTime(),
    );
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
        creado_en: true,
      },
    });
    if (contratos.length > 0) {
      return {
        id,
        nombre: contratos[0].inquilino_nombre,
        cedula: contratos[0].inquilino_cedula,
        telefono: contratos[0].inquilino_telefono,
        creado_en: contratos[contratos.length - 1].creado_en,
      };
    }
    return this.prisma.inquilino.findFirst({
      where: { id, arrendador_id: arrendadorId },
      select: SELECT_FICHA_PROPIA,
    });
  }

  /** Obsoleto: `POST /contratos` crea la identidad con `inquilino_nuevo`. */
  crear(
    dto: CrearInquilinoDto,
    arrendadorId: string,
  ): Promise<InquilinoSeguro> {
    const datos = normalizarYValidarDatosInquilino(dto);
    return this.prisma.inquilino.create({
      data: {
        arrendador_id: arrendadorId,
        nombre: datos.nombre,
        cedula: datos.cedula,
        telefono: datos.telefono,
      },
      select: SELECT_FICHA_PROPIA,
    });
  }
}
