// Mismo patrón usado para "Criterios y Parámetros" (Análisis de Red): un módulo ya
// visible en el menú y con permisos asignables, pero sin funcionalidad todavía --
// se va reemplazando por la pantalla real módulo por módulo.
export default function PlaceholderModulo({ titulo, descripcion }) {
  return (
    <div>
      <h2>{titulo}</h2>
      <p style={{ color: "#697386" }}>
        {descripcion || "Este módulo está en construcción."}
      </p>
    </div>
  );
}
