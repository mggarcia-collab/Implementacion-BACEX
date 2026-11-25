import HabilitarHr, { meta as habilitarHrMeta } from "./HabilitarHr.jsx";
import CambiarRtn, { meta as cambiarRtnMeta } from "./CambiarRtn.jsx";
import CrearSolicitudAforo, { meta as crearSolicitudAforoMeta } from "./CrearSolicitudAforo.jsx";
import ReasignarSolicitudAforo, { meta as reasignarSolicitudAforoMeta } from "./ReasignarSolicitudAforo.jsx";
import ActualizarRegimen, { meta as actualizarRegimenMeta } from "./ActualizarRegimen.jsx";
import CrearCriterioSolicitudPermiso, { meta as crearCriterioSolicitudPermisoMeta } from "./CrearCriterioSolicitudPermiso.jsx";
import ActualizarDatoFactura, { meta as actualizarDatoFacturaMeta } from "./ActualizarDatoFactura.jsx";
import ActualizarDatoOrdenCompra, { meta as actualizarDatoOrdenCompraMeta } from "./ActualizarDatoOrdenCompra.jsx";
import ActualizarAduanas, { meta as actualizarAduanasMeta } from "./ActualizarAduanas.jsx";
import CrearSolicitudPermiso, { meta as crearSolicitudPermisoMeta } from "./CrearSolicitudPermiso.jsx";
import CrearCriterioDti, { meta as crearCriterioDtiMeta } from "./CrearCriterioDti.jsx";
import CrearCriterioUad, { meta as crearCriterioUadMeta } from "./CrearCriterioUad.jsx";
import CrearCheckListSugerido, { meta as crearCheckListSugeridoMeta } from "./CrearCheckListSugerido.jsx";
import CrearCriterioOtroGestor, { meta as crearCriterioOtroGestorMeta } from "./CrearCriterioOtroGestor.jsx";
import CrearCriterioOtroGestorDetalle, { meta as crearCriterioOtroGestorDetalleMeta } from "./CrearCriterioOtroGestorDetalle.jsx";
import CargarPdf, { meta as cargarPdfMeta } from "./CargarPdf.jsx";
import RecordKeeping, { meta as recordKeepingMeta } from "./RecordKeeping.jsx";
import CriterioAnalistaCertificado, { meta as criterioAnalistaCertificadoMeta } from "./CriterioAnalistaCertificado.jsx";
import Facturacion, { meta as facturacionMeta } from "./Facturacion.jsx";
import MoverDeclaracion, { meta as moverDeclaracionMeta } from "./MoverDeclaracion.jsx";
import ActualizarProveedor, { meta as actualizarProveedorMeta } from "./ActualizarProveedor.jsx";
import ActualizarIdisEdis, { meta as actualizarIdisEdisMeta } from "./ActualizarIdisEdis.jsx";
import ActualizarFechaSellosAforo, { meta as actualizarFechaSellosAforoMeta } from "./ActualizarFechaSellosAforo.jsx";
import ActualizarDatosSelectivo, { meta as actualizarDatosSelectivoMeta } from "./ActualizarDatosSelectivo.jsx";
import ActualizarSubdivisionId, { meta as actualizarSubdivisionIdMeta } from "./ActualizarSubdivisionId.jsx";
import EliminarSolicitudPermisoRechazado, { meta as eliminarSolicitudPermisoRechazadoMeta } from "./EliminarSolicitudPermisoRechazado.jsx";
import CrearPagaresGlobales, { meta as crearPagaresGlobalesMeta } from "./CrearPagaresGlobales.jsx";

export const label = "Hoja de Ruta";
export const icon = "🗺️";

// Módulos pedidos de inicio para esta área -- todos como placeholder por ahora
// (ver PlaceholderModulo.jsx), se van reemplazando por la pantalla real uno a uno.
export const modules = {
  habilitarHr: { ...habilitarHrMeta, Component: HabilitarHr },
  cambiarRtn: { ...cambiarRtnMeta, Component: CambiarRtn },
  crearSolicitudAforo: { ...crearSolicitudAforoMeta, Component: CrearSolicitudAforo },
  reasignarSolicitudAforo: { ...reasignarSolicitudAforoMeta, Component: ReasignarSolicitudAforo },
  actualizarRegimen: { ...actualizarRegimenMeta, Component: ActualizarRegimen },
  crearCriterioSolicitudPermiso: { ...crearCriterioSolicitudPermisoMeta, Component: CrearCriterioSolicitudPermiso },
  actualizarDatoFactura: { ...actualizarDatoFacturaMeta, Component: ActualizarDatoFactura },
  actualizarDatoOrdenCompra: { ...actualizarDatoOrdenCompraMeta, Component: ActualizarDatoOrdenCompra },
  actualizarAduanas: { ...actualizarAduanasMeta, Component: ActualizarAduanas },
  crearSolicitudPermiso: { ...crearSolicitudPermisoMeta, Component: CrearSolicitudPermiso },
  crearCriterioDti: { ...crearCriterioDtiMeta, Component: CrearCriterioDti },
  crearCriterioUad: { ...crearCriterioUadMeta, Component: CrearCriterioUad },
  crearCheckListSugerido: { ...crearCheckListSugeridoMeta, Component: CrearCheckListSugerido },
  crearCriterioOtroGestor: { ...crearCriterioOtroGestorMeta, Component: CrearCriterioOtroGestor },
  crearCriterioOtroGestorDetalle: { ...crearCriterioOtroGestorDetalleMeta, Component: CrearCriterioOtroGestorDetalle },
  cargarPdf: { ...cargarPdfMeta, Component: CargarPdf },
  recordKeeping: { ...recordKeepingMeta, Component: RecordKeeping },
  criterioAnalistaCertificado: { ...criterioAnalistaCertificadoMeta, Component: CriterioAnalistaCertificado },
  facturacion: { ...facturacionMeta, Component: Facturacion },
  moverDeclaracion: { ...moverDeclaracionMeta, Component: MoverDeclaracion },
  actualizarProveedor: { ...actualizarProveedorMeta, Component: ActualizarProveedor },
  actualizarIdisEdis: { ...actualizarIdisEdisMeta, Component: ActualizarIdisEdis },
  actualizarFechaSellosAforo: { ...actualizarFechaSellosAforoMeta, Component: ActualizarFechaSellosAforo },
  actualizarDatosSelectivo: { ...actualizarDatosSelectivoMeta, Component: ActualizarDatosSelectivo },
  actualizarSubdivisionId: { ...actualizarSubdivisionIdMeta, Component: ActualizarSubdivisionId },
  eliminarSolicitudPermisoRechazado: { ...eliminarSolicitudPermisoRechazadoMeta, Component: EliminarSolicitudPermisoRechazado },
  crearPagaresGlobales: { ...crearPagaresGlobalesMeta, Component: CrearPagaresGlobales },
};

// Agrupa los módulos en el sidebar para que no se vean como una lista plana de 27.
// Unos cuantos no encajan 100% limpio en Actualizar/Crear/Modificar por su nombre
// (Habilitar HR, Record Keeping, Cargar PDF, Mover Declaración, Facturación, Eliminar
// Solicitud de Permiso Rechazada) -- se ubicaron por el efecto más parecido que tienen,
// y se mueven fácil si no es como se esperaba.
export const groups = [
  {
    label: "Crear", modules: [
      "crearSolicitudAforo", "crearCriterioSolicitudPermiso", "crearSolicitudPermiso",
      "crearCriterioDti", "crearCriterioUad", "crearCheckListSugerido",
      "crearCriterioOtroGestor", "crearCriterioOtroGestorDetalle", "cargarPdf",
      "criterioAnalistaCertificado", "facturacion", "crearPagaresGlobales",
    ]
  },
  {
    label: "Actualizar", modules: [
      "actualizarRegimen", "actualizarDatoFactura", "actualizarDatoOrdenCompra",
      "actualizarAduanas", "actualizarProveedor", "actualizarIdisEdis",
      "actualizarFechaSellosAforo", "actualizarDatosSelectivo", "actualizarSubdivisionId",
      "recordKeeping",
    ]
  },
  {
    label: "Modificar", modules: [
      "habilitarHr", "cambiarRtn", "reasignarSolicitudAforo", "moverDeclaracion",
      "eliminarSolicitudPermisoRechazado",
    ]
  },
];
