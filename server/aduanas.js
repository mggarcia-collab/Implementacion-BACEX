// Catálogo canónico de Aduanas para la restricción de usuarios por Aduana (Administración →
// Usuarios → Oficinas/Aduanas permitidas). La fuente REAL de la Aduana de una Referencia
// Operativa es HojaDeRuta.dbo.HojaRuta.AduanaDescripcion -- un campo de texto libre con 150+
// variantes de escritura para las mismas Aduanas reales (ej. "La Mesa", "ADUANA LA MESA" son
// la misma Aduana; "ADUANA TERRESTRE EL FLORIDO HN"/"EL FLORIDO GT" son variantes del mismo
// cruce). Esta lista agrupa esas variantes bajo una clave canónica mediante coincidencia de
// palabra clave (normalizada: mayúsculas, sin acentos), en vez de depender de una lista exacta
// de strings que se rompería con la próxima variante de escritura no vista todavía.
//
// OJO: CfoNetCore.dbo.SalesOrder.OficinaVenta NO es esto -- es otro campo (ruteo/logística
// interna) que puede no coincidir con la Aduana real que ve el negocio (confirmado con un caso
// real: Referencia con OficinaVenta de "La Mesa" pero Aduana real de Hoja de Ruta totalmente
// distinta). No usar OficinaVenta para esta restricción.
export const ADUANAS_CANONICAS = {
    puertoCortes: { label: "Puerto Cortés", keywords: ["PUERTO CORTE"] },
    corinto: { label: "Corinto", keywords: ["CORINTO"] },
    guasaule: { label: "Guasaule", keywords: ["GUASAULE"] },
    elFlorido: { label: "El Florido", keywords: ["FLORIDO"] },
    amatillo: { label: "Amatillo", keywords: ["AMATILLO"] },
    aguaCaliente: { label: "Agua Caliente", keywords: ["AGUA CALIENTE"] },
    elPoy: { label: "El Poy", keywords: ["EL POY", "POY SV", "POY HN"] },
    lasManos: { label: "Las Manos", keywords: ["MANOS"] },
    laMesa: { label: "La Mesa", keywords: ["MESA"] },
    puertoCastilla: { label: "Puerto Castilla", keywords: ["PUERTO CASTILLA"] },
    toncontin: { label: "Toncontín", keywords: ["TONCONTIN"] },
    sanLorenzo: { label: "San Lorenzo", keywords: ["SAN LORENZO", "HENECAN"] },
    laCeiba: { label: "La Ceiba", keywords: ["LA CEIBA"] },
    pedroDeAlvarado: { label: "Pedro de Alvarado", keywords: ["PEDRO DE ALVARADO", "PEDRO ALVARADO"] },
    tecunUman: { label: "Tecún Umán", keywords: ["TECUN UMAN"] },
    penasBlancas: { label: "Peñas Blancas", keywords: ["PENAS BLANCAS"] },
    sanCristobal: { label: "San Cristóbal", keywords: ["SAN CRISTOBAL"] },
    laHachadura: { label: "La Hachadura", keywords: ["HACHADURA"] },
    anguiatu: { label: "Anguiatú", keywords: ["ANGUIATU"] },
    valleNuevo: { label: "Valle Nuevo", keywords: ["VALLE NUEVO"] },
    elEspino: { label: "El Espino", keywords: ["EL ESPINO"] },
    lasChinamas: { label: "Las Chinamas", keywords: ["CHINAMAS"] },
    melchorDeMencos: { label: "Melchor de Mencos", keywords: ["MELCHOR DE MENCOS"] },
    sanBartolo: { label: "San Bartolo", keywords: ["SAN BARTOLO"] },
};

function normalizar(texto) {
    return String(texto || "")
        .toUpperCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// Devuelve la clave canónica (ej. "laMesa") que corresponde a un AduanaDescripcion real de
// Hoja de Ruta, o null si no coincide con ninguna Aduana conocida (ej. almacenes fiscales,
// aeropuertos o clientes con despacho propio como "ZOLI MAGNO..." -- esos no son ninguna de
// las Aduanas de este catálogo, así que un usuario restringido no los verá, que es lo correcto).
export function aduanaCanonicaDeTexto(aduanaDescripcion) {
    const normalizado = normalizar(aduanaDescripcion);
    if (!normalizado) return null;
    for (const [clave, a] of Object.entries(ADUANAS_CANONICAS)) {
        if (a.keywords.some((kw) => normalizado.includes(normalizar(kw)))) return clave;
    }
    return null;
}
