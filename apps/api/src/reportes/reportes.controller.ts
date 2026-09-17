import { Controller, Get, Inject, Query } from "@nestjs/common";
import { RolUsuario } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { TenantContext } from "../auth/jwt.service";
import { Roles } from "../auth/roles.decorator";
import { ReportesQueryDto } from "./dto/reportes-query.dto";
import { ReportesService } from "./reportes.service";

@Controller("reportes")
export class ReportesController {
  constructor(@Inject(ReportesService) private readonly reportesService: ReportesService) {}

  @Roles(RolUsuario.admin)
  @Get()
  obtenerReportes(@Query() query: ReportesQueryDto, @CurrentUser() user: TenantContext) {
    return this.reportesService.obtenerReportes(query, user);
  }
}
