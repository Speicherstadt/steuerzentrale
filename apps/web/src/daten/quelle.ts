import { demo } from "../demo/index.ts";
import type { Bestand } from "./typen.ts";

/**
 * The data the pages read. Until the Zentrale has its API, this is the demo fixtures of src/demo/;
 * Z-406 replaces it with the API and keeps the fixtures for `bun run dev:demo` (Vite's mode "demo").
 * The customer pages already read their customers from src/daten/kunden.ts (Z-801).
 */
export const bestand = (): Bestand => demo;
