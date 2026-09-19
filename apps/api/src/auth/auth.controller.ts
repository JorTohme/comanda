import { Body, Controller, Inject, Post } from "@nestjs/common";
import { RolUsuario } from "@prisma/client";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { CurrentUserId } from "./current-user-id.decorator";
import { TenantContext } from "./jwt.service";
import { Public } from "./public.decorator";
import { Roles } from "./roles.decorator";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { SwitchSucursalDto } from "./dto/switch-sucursal.dto";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post("logout")
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
    return { status: "ok" };
  }

  // No @Public() here on purpose: this must go through JwtAuthGuard + @Roles(admin) like
  // every other protected endpoint, unlike the four methods above.
  @Roles(RolUsuario.admin)
  @Post("switch-sucursal")
  switchSucursal(
    @Body() dto: SwitchSucursalDto,
    @CurrentUserId() usuarioId: string,
    @CurrentUser() user: TenantContext,
  ) {
    return this.authService.switchSucursal(usuarioId, user.orgId, dto.sucursalId);
  }
}
