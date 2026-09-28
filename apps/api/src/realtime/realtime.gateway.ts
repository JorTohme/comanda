import { Inject, Logger } from "@nestjs/common";
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { RealtimeEventName, RealtimeServerPayload } from "@comanda/shared";
import { JwtService } from "../auth/jwt.service";

function sala(sucursalId: string): string {
  return `sucursal:${sucursalId}`;
}

@WebSocketGateway({ cors: { origin: "*" } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  handleConnection(client: Socket): void {
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error("missing token");
      const { sucursalId, exp } = this.jwt.verify(token);
      const expiresAt = exp * 1000;
      if (!Number.isSafeInteger(exp) || expiresAt <= Date.now()) {
        throw new Error("invalid or expired token");
      }

      expiryTimer = setTimeout(() => client.disconnect(true), expiresAt - Date.now());
      client.once("disconnect", () => clearTimeout(expiryTimer));
      client.join(sala(sucursalId));
    } catch {
      if (expiryTimer) clearTimeout(expiryTimer);
      client.disconnect(true);
    }
  }

  emitToSucursal<TEvent extends RealtimeEventName>(sucursalId: string, evento: TEvent, payload: RealtimeServerPayload<TEvent>): void {
    try {
      this.server?.to(sala(sucursalId)).emit(evento, payload);
    } catch (error) {
      this.logger.error(`Failed to publish ${evento} to sucursal ${sucursalId}`, error instanceof Error ? error.stack : undefined);
    }
  }
}
