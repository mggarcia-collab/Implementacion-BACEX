import InvoiceIncorrecto, { meta as invoiceMeta } from "./InvoiceIncorrecto.jsx";
import ArrivalDate, { meta as arrivalMeta } from "./ArrivalDate.jsx";
import ClearanceDate, { meta as clearanceMeta } from "./ClearanceDate.jsx";

export const label = "Panel Errores 25+";
export const icon = "⚠️";

export const modules = {
  invoice_incorrecto: { ...invoiceMeta, Component: InvoiceIncorrecto },
  arrival_date: { ...arrivalMeta, Component: ArrivalDate },
  clearance_date: { ...clearanceMeta, Component: ClearanceDate },
};
