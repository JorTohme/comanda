import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { JwtClaims } from "./jwt.service";

export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): JwtClaims =>
  context.switchToHttp().getRequest<{ user: JwtClaims }>().user,
);
