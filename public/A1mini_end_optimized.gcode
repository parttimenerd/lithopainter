;===== machine: A1 mini — optimized end sequence (no AMS) =====
;===== date: 20260513 ==================
; Nozzle kept at 100°C standby for fast back-to-back prints.

M400
G92 E0
G90
G1 Z{max_layer_z + 0.4} F3000
G1 X0 Y{first_layer_center_no_wipe_tower[1]} F18000
G1 X-13.0 F3000

M140 S0 ; turn off bed
M104 S100 ; standby temp — reheats fast, won't ooze
M106 S0
M106 P2 S0
M106 P3 S0

M400
M17 S
M17 Z0.4
{if (max_layer_z + 100.0) < 180}
    G1 Z{max_layer_z + 100.0} F600
    G1 Z{max_layer_z + 98.0}
{else}
    G1 Z180 F600
    G1 Z180
{endif}
M400 P100
M17 R

G90
G1 X-13 Y180 F18000

G91
G1 Z-1 F600
G90
M83

M220 S100
M201.2 K1.0
M73.2 R1.0
M1002 set_gcode_claim_speed_level : 0

M400 S1
M18 X Y Z
