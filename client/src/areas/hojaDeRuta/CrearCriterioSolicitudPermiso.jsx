import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Crear Criterio de Solicitud de Permiso",
  icon: "📋",
  desc: "Crear un nuevo criterio de solicitud de permiso",
  kind: "primary",
};

export default function CrearCriterioSolicitudPermiso() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
