import Matriz, { meta as matrizMeta } from "./Matriz.jsx";
import CriteriosParametros, { meta as criteriosParametrosMeta } from "./CriteriosParametros.jsx";

export const label = "Análisis de Red";
export const icon = "🔗";

export const modules = {
  matriz: { ...matrizMeta, Component: Matriz },
  criteriosParametros: { ...criteriosParametrosMeta, Component: CriteriosParametros },
};
