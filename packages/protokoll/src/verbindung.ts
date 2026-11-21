/*
 * The agent's connection (BAULISTE.md Z-303), the values both sides keep to: the agent opens a
 * WebSocket to `agent.<domain>` with its client certificate, says `hallo`, gets `willkommen`, and
 * sends a heartbeat every 30 seconds; in the last 30 days of its certificate it asks for a new one.
 */

/** The path of the connection under `agent.<domain>` */
export const VERBINDUNG_PFAD = "/api/v1/agent/verbindung";

/** How often the agent sends a heartbeat */
export const HEARTBEAT_MS = 30_000;

/** How long before its certificate ends the agent asks for a new one, and the Zentrale issues it */
export const ROTIEREN_VOR_MS = 30 * 24 * 3600_000;

/**
 * How often the agent sends its facts (Z-304), besides once after every `willkommen`: they change
 * slowly (packages, reboots, disks), the disk checks of Z-702 need no finer grain, and 96 rows a day
 * per server keep the 30 days of history small
 */
export const FAKTEN_MS = 15 * 60_000;
