;===== machine: A1 mini — optimized start (no AMS, pre-levelled bed) =====
;===== date: 20260513 ==================
; Assumptions: direct spool (no AMS), bed already levelled, not a first print.

;===== start heating — bed/nozzle heat while we home =====
M1002 gcode_claim_action : 2
M1002 set_filament_type:{filament_type[initial_no_support_extruder]}
M104 S{nozzle_temperature_initial_layer[initial_no_support_extruder]}
M140 S[bed_temperature_initial_layer_single]

;===== reset machine status =================
M204 S6000
M630 S0 P0
M9833.2
M17 X0.7 Y0.9 Z0.5
M960 S5 P1
M83
M220 S100
M221 S100
M73.2 R1.0
M982.2 S1

;===== home ==========
G90
G28 X
G28 Z P0 T300
G29.2 S0
M211 X0 Y0 Z0
M975 S1

;===== wipe nozzle ===============================
M1002 gcode_claim_action : 14
M106 S255
M211 S
M211 X0 Y0 Z0

M83
G1 E-1 F2400
G90

M109 S170
M104 S140
G0 X90 Y-4 F30000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X91 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X92 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X93 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X94 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X95 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X96 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X97 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X98 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200
G1 Z2 F1200
G1 X99 F10000
G380 S3 Z-5 F1200

G1 Z5 F30000
G1 X25 Y175 F30000
G1 Z0.2 F30000
G1 Y185
G91
G1 X-30 F30000
G1 Y-2
G1 X27
G1 Y1.5
G1 X-28
G1 Y-2
G1 X30
G1 Y1.5
G1 X-30
G90
M83

G1 Z5 F30000
G0 X50 Y175 F30000

G0 X85 Y185 F30000
G0 Z-1.01 F10000
G91
G2 I1 J0 X2 Y0 F2000.1
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5
G2 I1 J0 X2
G2 I-0.75 J0 X-1.5

G90
G1 Z5 F30000
G1 X25 Y175 F30000
G1 Z0.2 F30000
G1 Y185
G91
G1 X-30 F30000
G1 Y-2
G1 X27
G1 Y1.5
G1 X-28
G1 Y-2
G1 X30
G1 Y1.5
G1 X-30
G90
M83

G1 Z10 F30000
G1 X85 Y185 F30000
G1 Z-1.01 F10000
G1 X95
G1 X90

M211 R
M106 S0
;===== wipe nozzle end ================================

;===== wait heatbed ====================
M1002 gcode_claim_action:54
M104 S0
M190 S[bed_temperature_initial_layer_single]
M109 S140

G1 Z5 F30000
G29.2 S1
G1 X10 Y10 F30000

;===== final home ====================
M1002 gcode_claim_action : 13
G28 T145

M975 S1
G90
M83
T1000

M1002 set_filament_type:{filament_type[initial_no_support_extruder]}
M412 S1
M400 P10

;===== prime line ===============================
M109 S{nozzle_temperature_initial_layer[initial_extruder]}
G0 X68 Y-2.5 F30000
G0 Z0.3 F18000
G0 X88 E10  F{outer_wall_volumetric_speed/(24/20)*60}
G0 X93 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)/4*60}
G0 X98 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)*60}
G0 X103 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)/4*60}
G0 X108 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)*60}
G0 X113 E.3742  F{outer_wall_volumetric_speed/(0.3*0.5)/4*60}
G0 X115 Z0 F20000
G0 Z5
M400

;===== ready ======================================
M1002 gcode_claim_action : 0

{if curr_bed_type=="Textured PEI Plate"}
G29.1 Z{-0.02}
{endif}

M975 S1
G90
M83
T1000
M211 X0 Y0 Z0
M1007 S1
