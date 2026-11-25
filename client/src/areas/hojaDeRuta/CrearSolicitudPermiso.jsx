import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Crear Solicitud de Permiso",
  icon: "📝",
  desc: "Crear una nueva solicitud de permiso",
  kind: "primary",
};

export default function CrearSolicitudPermiso() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
