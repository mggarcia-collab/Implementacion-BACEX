import Incidentes, { meta as incidentesMeta } from "./Incidentes.jsx";

export const label = "Soporte";
export const icon = "🎫";

export const modules = {
  incidentes: { ...incidentesMeta, Component: Incidentes },
};
