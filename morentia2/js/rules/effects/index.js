// Point d'entrée des effets : importer ce module suffit à peupler le registre.
//
// Chaque fichier déclare les cartes d'une provenance. Ajouter une carte ou
// corriger une règle se fait ici, sans toucher au moteur ni à l'interface.

import './kalassir.js';
import './aqaba.js';
import './algarie.js';
import './market.js';
import './special.js';
import './places.js';

export { CARD_EFFECTS, PLACE_EFFECTS, effectsOf, placeEffectsOf, isAutomated } from '../registry.js';
