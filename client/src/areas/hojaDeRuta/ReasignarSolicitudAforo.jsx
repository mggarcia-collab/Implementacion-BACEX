import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Reasignar Solicitud de Aforo",
  icon: "🔁",
  desc: "Reasignar una solicitud de aforo existente",
  kind: "primary",
};

export default function ReasignarSolicitudAforo() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
