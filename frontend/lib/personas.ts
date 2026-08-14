import raw from "./personas-data.json";

export interface PersonaMonth {
  month: string;
  inflow_usd: number;
  outflow_usd: number;
}

export interface Persona {
  persona_id: string;
  display_name: string;
  wallet: string;
  history_months: number;
  months: PersonaMonth[];
}

export const DEMO_DATA_LABEL = (raw as { _label: string })._label;
export const personas = (raw as { personas: Persona[] }).personas;
