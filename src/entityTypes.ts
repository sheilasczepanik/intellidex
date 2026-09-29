export type EntityKind = "People" | "Places" | "Vehicles" | "Phones" | "Digital" | "Exhibits";

export interface FieldDef {
  k: string;
  label: string;
  ph: string;
  half?: boolean;
  area?: boolean;
}

export interface KindSchema {
  noun: string;
  statuses: string[];
  fields: FieldDef[];
}

export interface WizardFormState {
  tab: EntityKind;
  id: string | null;
  name: string;
  chip: string;
  v: Record<string, string>;
}
