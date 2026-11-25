import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Eliminar Solicitud de Permiso Rechazada",
  icon: "🗑️",
  desc: "Eliminar una solicitud de permiso en estado Rechazado",
  kind: "danger",
};

export default function EliminarSolicitudPermisoRechazado() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
