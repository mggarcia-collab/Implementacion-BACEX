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
import CrearProveedorCliente, { meta as crearProveedorClienteMeta } from "./CrearProveedorCliente.jsx";
import EliminarModificarLineaMaterial, { meta as eliminarModificarLineaMaterialMeta } from "./EliminarModificarLineaMaterial.jsx";
import CrearDocumentosPostFacturacion, { meta as crearDocumentosPostFacturacionMeta } from "./CrearDocumentosPostFacturacion.jsx";
import CrearEspecieFiscal, { meta as crearEspecieFiscalMeta } from "./CrearEspecieFiscal.jsx";
import CajaChica, { meta as cajaChicaMeta } from "./CajaChica.jsx";
import IndicadorImpuestoSalesOrder, { meta as indicadorImpuestoMeta } from "./IndicadorImpuestoSalesOrder.jsx";
import MaterialesNegociacion, { meta as materialesNegociacionMeta } from "./MaterialesNegociacion.jsx";

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
  crearProveedorCliente: { ...crearProveedorClienteMeta, Component: CrearProveedorCliente },
  eliminarModificarLineaMaterial: { ...eliminarModificarLineaMaterialMeta, Component: EliminarModificarLineaMaterial },
  crearDocumentosPostFacturacion: { ...crearDocumentosPostFacturacionMeta, Component: CrearDocumentosPostFacturacion },
  crearEspecieFiscal: { ...crearEspecieFiscalMeta, Component: CrearEspecieFiscal },
  cajaChica: { ...cajaChicaMeta, Component: CajaChica },
  indicadorImpuesto: { ...indicadorImpuestoMeta, Component: IndicadorImpuestoSalesOrder },
  materialesNegociacion: { ...materialesNegociacionMeta, Component: MaterialesNegociacion },
};

// Agrupa los módulos de CFO en el sidebar para que no se vean como una lista plana larga.
// "Documentos" se separó en Crear vs Modificar (eran 6 módulos juntos) y Línea Material se
// movió de Eliminación a Modificar Documentos, ya que ese módulo agrega y edita, no solo elimina.
export const groups = [
  { label: "Gestión", modules: ["negociaciones", "cambio", "salesorder"] },
  { label: "Crear Documentos", modules: ["docProvisionalNic", "cuadrilla", "crearDocumentosPostFacturacion", "crearEspecieFiscal"] },
  { label: "Modificar Documentos", modules: ["habDoc", "redondeo", "eliminarModificarLineaMaterial", "indicadorImpuesto"] },
  { label: "Eliminación / Anulación", modules: ["contrarecibo", "elimDoc", "anulacionFacturas"] },
  { label: "Catálogos", modules: ["crearProveedorCliente"] },
  { label: "Administración", modules: ["cajaChica", "materialesNegociacion"] },
];
