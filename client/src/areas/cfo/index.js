import Negociaciones, { meta as negociacionesMeta } from "./Negociaciones.jsx";
import CambioComponente, { meta as cambioMeta } from "./CambioComponente.jsx";
import SalesOrder, { meta as salesorderMeta } from "./SalesOrder.jsx";
import HabilitarDocumento, { meta as habDocMeta } from "./HabilitarDocumento.jsx";
import EliminarContraRecibo, { meta as contrareciboMeta } from "./EliminarContraRecibo.jsx";
import EliminarDocumento, { meta as elimDocMeta } from "./EliminarDocumento.jsx";
import RedondeoDocumentos, { meta as redondeoMeta } from "./RedondeoDocumentos.jsx";
import DocumentoProvisionalNic, { meta as docProvisionalNicMeta } from "./DocumentoProvisionalNic.jsx";
import AnulacionFacturas, { meta as anulacionFacturasMeta } from "./AnulacionFacturas.jsx";
import Cuadrilla, { meta as cuadrillaMeta } from "./Cuadrilla.jsx";

export const label = "CFO / Finanzas";
export const icon = "📊";

export const modules = {
  negociaciones: { ...negociacionesMeta, Component: Negociaciones },
  cambio: { ...cambioMeta, Component: CambioComponente },
  salesorder: { ...salesorderMeta, Component: SalesOrder },
  habDoc: { ...habDocMeta, Component: HabilitarDocumento },
  contrarecibo: { ...contrareciboMeta, Component: EliminarContraRecibo },
  elimDoc: { ...elimDocMeta, Component: EliminarDocumento },
  redondeo: { ...redondeoMeta, Component: RedondeoDocumentos },
  docProvisionalNic: { ...docProvisionalNicMeta, Component: DocumentoProvisionalNic },
  anulacionFacturas: { ...anulacionFacturasMeta, Component: AnulacionFacturas },
  cuadrilla: { ...cuadrillaMeta, Component: Cuadrilla },
};

// Agrupa los módulos de CFO en el sidebar para que no se vean como una lista plana larga.
export const groups = [
  { label: "Gestión", modules: ["negociaciones", "cambio", "salesorder"] },
  { label: "Documentos", modules: ["habDoc", "redondeo", "docProvisionalNic", "cuadrilla"] },
  { label: "Eliminación", modules: ["contrarecibo", "elimDoc", "anulacionFacturas"] },
];
