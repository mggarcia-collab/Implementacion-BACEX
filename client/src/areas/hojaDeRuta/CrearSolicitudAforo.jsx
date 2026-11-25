import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Crear Solicitud de Aforo",
  icon: "🧾",
  desc: "Crear una nueva solicitud de aforo",
  kind: "primary",
};

export default function CrearSolicitudAforo() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
