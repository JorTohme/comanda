import { Inject } from "@nestjs/common";
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { JwtService } from "../auth/jwt.service";

function sala(sucursalId: string): string {
  return `sucursal:${sucursalId}`;
}

@WebSocketGateway({ cors: { origin: "*" } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

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

  emitToSucursal(sucursalId: string, evento: string, payload: unknown): void {
    this.server.to(sala(sucursalId)).emit(evento, payload);
  }
}
