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

  afterEach(() => {
    jest.useRealTimers();
  });

  function fakeClient(auth: Record<string, unknown> = {}) {
    const listeners: Record<string, () => void> = {};
    return {
      handshake: { auth },
      join: jest.fn(),
      disconnect: jest.fn(),
      once: jest.fn((event: string, listener: () => void) => {
        listeners[event] = listener;
      }),
      trigger: (event: string) => listeners[event]?.(),
    };
  }

  it("joins the sucursal room when the token is valid", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-27T12:00:00.000Z"));
    jwt.verify.mockReturnValue({ sucursalId: "sucursal-1", exp: Date.now() / 1000 + 3_600 });
    const client = fakeClient({ token: "valid-token" });

    gateway.handleConnection(client as never);

    expect(jwt.verify).toHaveBeenCalledWith("valid-token");
    expect(client.join).toHaveBeenCalledWith("sucursal:sucursal-1");
    expect(client.disconnect).not.toHaveBeenCalled();
    client.trigger("disconnect");
  });

  it("disconnects a client when its access token expires", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-27T12:00:00.000Z"));
    jwt.verify.mockReturnValue({ sucursalId: "sucursal-1", exp: Date.now() / 1000 + 5 });
    const client = fakeClient({ token: "valid-token" });

    gateway.handleConnection(client as never);
    expect(client.disconnect).not.toHaveBeenCalled();

    jest.advanceTimersByTime(4_999);
    expect(client.disconnect).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects a client when the verified token has no expiry", () => {
    jwt.verify.mockReturnValue({ sucursalId: "sucursal-1" });
    const client = fakeClient({ token: "token-without-exp" });

    gateway.handleConnection(client as never);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("disconnects a client when the verified token is already expired", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-27T12:00:00.000Z"));
    jwt.verify.mockReturnValue({ sucursalId: "sucursal-1", exp: Date.now() / 1000 - 1 });
    const client = fakeClient({ token: "expired-token" });

    gateway.handleConnection(client as never);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it("clears the expiry timer when the client disconnects first", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-27T12:00:00.000Z"));
    jwt.verify.mockReturnValue({ sucursalId: "sucursal-1", exp: Date.now() / 1000 + 5 });
    const client = fakeClient({ token: "valid-token" });

    gateway.handleConnection(client as never);
    client.trigger("disconnect");

    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(5_000);
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
