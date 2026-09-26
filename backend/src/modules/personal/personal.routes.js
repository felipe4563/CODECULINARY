const { Router } = require('express');
const ctrl = require('./personal.controller');
const auth = require('../../middlewares/auth');
const { requiereSucursalActiva } = require('../../middlewares/sucursalActiva');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

// Marcar la propia asistencia no requiere ningún permiso especial — es una
// acción sobre uno mismo (ver spec). Las rutas de administración se agregan
// en Task 3, gateadas por el permiso personal.administrar.
router.post('/marcar', requiereSucursalActiva, ctrl.marcar);
router.get('/mi-estado', ctrl.miEstado);
router.post('/marcaciones/:id/proponer-salida', ctrl.proponerSalida);

// Administración — requiere personal.administrar
router.get('/filtros', verificarPermiso('personal', 'administrar'), ctrl.filtros);
router.get('/horarios/:usuario_id', verificarPermiso('personal', 'administrar'), ctrl.obtenerHorario);
router.put('/horarios/:usuario_id', verificarPermiso('personal', 'administrar'), ctrl.guardarHorario);
router.get('/marcaciones', verificarPermiso('personal', 'administrar'), ctrl.listarMarcaciones);
router.patch('/marcaciones/:id/resolver', verificarPermiso('personal', 'administrar'), ctrl.resolverCierreAutomatico);

module.exports = router;
