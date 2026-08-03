import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { Injectable, NotFoundException } from "@nestjs/common";
import makeWASocket, { useMultiFileAuthState, type WASocket } from "@whiskeysockets/baileys";
import QRCode from "qrcode";

import type { AuthenticatedContext } from "../authorization/authorization-context";

type ConnectionStatus = "DISCONNECTED" | "CONNECTING" | "QR_READY" | "CONNECTED";
type Connection = { status: ConnectionStatus; qr: string | null; qrDataUrl: string | null; phone: string | null; socket?: WASocket };

function organizationId(auth: AuthenticatedContext) {
  if (!auth.organizationId) {
    throw new NotFoundException({ code: "ORGANIZATION_NOT_FOUND", message: "Organization context is required" });
  }
  return auth.organizationId;
}

@Injectable()
export class WhatsAppService {
  private readonly connections = new Map<string, Connection>();

  status(auth: AuthenticatedContext) {
    const connection = this.connections.get(organizationId(auth));
    return { status: connection?.status ?? "DISCONNECTED", qrDataUrl: connection?.qrDataUrl ?? null, phone: connection?.phone ?? null };
  }

  async connect(auth: AuthenticatedContext) {
    const orgId = organizationId(auth);
    const active = this.connections.get(orgId);
    if (active?.status === "CONNECTED" || active?.status === "CONNECTING" || active?.status === "QR_READY") {
      return this.status(auth);
    }

    const authDirectory = join(process.cwd(), ".data", "baileys", orgId);
    await mkdir(authDirectory, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory);
    const connection: Connection = { status: "CONNECTING", qr: null, qrDataUrl: null, phone: null };
    this.connections.set(orgId, connection);
    const socket = makeWASocket({ auth: state, markOnlineOnConnect: false, syncFullHistory: false });
    connection.socket = socket;

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", async (update) => {
      if (update.qr) {
        connection.status = "QR_READY";
        connection.qr = update.qr;
        connection.qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 280 });
      }
      if (update.connection === "open") {
        connection.status = "CONNECTED";
        connection.qr = null;
        connection.qrDataUrl = null;
        connection.phone = socket.user?.id?.split(":")[0] ?? null;
      }
      if (update.connection === "close") {
        connection.status = "DISCONNECTED";
        connection.qr = null;
        connection.qrDataUrl = null;
        connection.socket = undefined;
      }
    });
    return this.status(auth);
  }

  async disconnect(auth: AuthenticatedContext) {
    const orgId = organizationId(auth);
    const connection = this.connections.get(orgId);
    if (connection?.socket) connection.socket.end(undefined);
    this.connections.delete(orgId);
    return this.status(auth);
  }
}
