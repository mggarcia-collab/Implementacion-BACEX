import * as cfo from "./cfo/index.js";
import * as red from "./red/index.js";
import * as errores25 from "./errores25/index.js";
import * as soporte from "./soporte/index.js";
import * as hojaDeRuta from "./hojaDeRuta/index.js";

// Agrupamos los módulos por Áreas Globales (CFO, RED, ERRORES25, SOPORTE, HOJA DE RUTA)
export const areas = {
  cfo: { label: cfo.label, icon: cfo.icon, modules: cfo.modules, groups: cfo.groups },
  red: { label: red.label, icon: red.icon, modules: red.modules },
  errores25: { label: errores25.label, icon: errores25.icon, modules: errores25.modules },
  soporte: { label: soporte.label, icon: soporte.icon, modules: soporte.modules },
  hojaDeRuta: { label: hojaDeRuta.label, icon: hojaDeRuta.icon, modules: hojaDeRuta.modules, groups: hojaDeRuta.groups },
};
