const { Router } = require('express');
const ctrl = require('./personal.controller');
const auth = require('../../middlewares/auth');
const { requiereSucursalActiva } = require('../../middlewares/sucursalActiva');

const router = Router();
router.use(auth);

// Marcar la propia asistencia no requiere ningún permiso especial — es una
// acción sobre uno mismo (ver spec). Las rutas de administración se agregan
// en Task 3, gateadas por el permiso personal.administrar.
router.post('/marcar', requiereSucursalActiva, ctrl.marcar);
router.get('/mi-estado', ctrl.miEstado);
router.post('/marcaciones/:id/proponer-salida', ctrl.proponerSalida);

module.exports = router;
