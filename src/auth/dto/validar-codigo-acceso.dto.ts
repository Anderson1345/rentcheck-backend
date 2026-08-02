import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class ValidarCodigoAccesoDto {
  @ApiProperty({ example: "ABC123" })
  @IsString()
  @IsNotEmpty()
  codigo: string;
}
