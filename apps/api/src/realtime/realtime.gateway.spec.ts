import { Test } from "@nestjs/testing";
import { RealtimeGateway } from "./realtime.gateway";
import { JwtService } from "../auth/jwt.service";

describe("RealtimeGateway", () => {
  let gateway: RealtimeGateway;
  const jwt = { verify: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [RealtimeGateway, { provide: JwtService, useValue: jwt }],
    }).compile();

    gateway = moduleRef.get(RealtimeGateway);
  });

  function fakeClient(auth: Record<string, unknown> = {}) {
    return {
      handshake: { auth },
      join: jest.fn(),
      disconnect: jest.fn(),
    };
  }

  it("joins the sucursal room when the token is valid", () => {
    jwt.verify.mockReturnValue({ sucursalId: "sucursal-1" });
    const client = fakeClient({ token: "valid-token" });

    gateway.handleConnection(client as never);

    expect(jwt.verify).toHaveBeenCalledWith("valid-token");
    expect(client.join).toHaveBeenCalledWith("sucursal:sucursal-1");
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it("disconnects a client with no token", () => {
    const client = fakeClient({});

    gateway.handleConnection(client as never);

    expect(jwt.verify).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects a client with an invalid token", () => {
    jwt.verify.mockImplementation(() => {
      throw new Error("invalid token");
    });
    const client = fakeClient({ token: "bad-token" });

    gateway.handleConnection(client as never);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("emitToSucursal emits to the sucursal room", () => {
    const server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    gateway.server = server as never;

    gateway.emitToSucursal("sucursal-1", "pedido.actualizado", { id: "pedido-1" });

    expect(server.to).toHaveBeenCalledWith("sucursal:sucursal-1");
    expect(server.emit).toHaveBeenCalledWith("pedido.actualizado", { id: "pedido-1" });
  });
});
