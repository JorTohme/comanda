import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { JwtClaims } from "./jwt.service";

export const CurrentUserId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  return context.switchToHttp().getRequest<{ user: JwtClaims }>().user.sub;
});
