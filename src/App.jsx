import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Canvas, useThree, extend, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { LASLoader } from '@loaders.gl/las'
import { LASFile } from '../node_modules/@loaders.gl/las/dist/lib/laslaz-decoder.js'
import { load } from '@loaders.gl/core'

// Extend Three.js with any custom objects if needed
extend({ Points: THREE.Points })

const TOWER_SMALL_NAME = '小号侧'
const TOWER_LARGE_NAME = '大号侧'
const DEFAULT_CATEGORY_DICT = {
    1: 'Background',
    2: 'Tower',
    3: 'Insulator',
    4: 'Line'
}

const VOLTAGE_LEVEL_OPTIONS = [
    '',
    '10kV',
    '35kV',
    '66kV',
    '110kV',
    '220kV',
    '330kV',
    '500kV',
    '750kV',
    '1000kV',
    '±400kV',
    '±500kV',
    '±660kV',
    '±800kV',
    '接地极线',
    '1000kV单回',
    '1000kV双回',
    '±1100kV'
]

const TOWER_TYPE1_OPTIONS = ['', '直线塔', '耐张塔']
const TOWER_TYPE2_OPTIONS = ['', '⽺⻆', '⿎型', '猫头', '⼲字', '上字', '紧凑塔型', '其他']
const TRANSMISSION_TYPE_OPTIONS = ['', 'AC', 'DC']
const NUM_CIRCUIT_OPTIONS = ['', '1', '2', '3', '4']

const LOOP_OPTIONS = ['', '左回', '右回', 'Ⅰ回', 'Ⅱ回', 'Ⅲ回', 'Ⅳ回']
const PHASE_OPTIONS = ['', '上相', '中相', '下相', '左相', '右相', '极Ⅰ', '极Ⅱ']
const POSITION_OPTIONS = ['', '左侧', '右侧', '小号侧', '大号侧', '跳线串', 'V串', 'V串左', 'V串右']
const COMPONENT_TYPE_OPTIONS = [
    '',
    '塔全貌',
    '塔头',
    '塔身',
    '杆号牌',
    '塔基',
    '绝缘子串',
    '地线',
    '地线挂点',
    '通道',
    '导线端挂点',
    '横担端挂点',
    '拐弯点'
]

const BASE_POINT_SIZES = {
    0: 20,
    1: 28,
    2: 26,
    3: 34
}

const toNumber = (value, fallback = 0) => {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : fallback
}

const normalizeTransmissionType = (value) => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    if (TRANSMISSION_TYPE_OPTIONS.includes(text)) return text
    const upper = text.toUpperCase()
    if (upper.includes('AC') || text.includes('交流')) return 'AC'
    if (upper.includes('DC') || text.includes('直流')) return 'DC'
    return text
}

const buildComponentName = (towerSide, phase, position, componentType) => {
    if (position === TOWER_SMALL_NAME || position === TOWER_LARGE_NAME) {
        return position
    }
    const parts = [towerSide, phase, position, componentType].filter(Boolean)
    return parts.join('-')
}

const readComponentCoord = (component) => {
    if (!component) return [0, 0, 0]
    if (Array.isArray(component.coord) && component.coord.length >= 3) {
        return [
            toNumber(component.coord[0]),
            toNumber(component.coord[1]),
            toNumber(component.coord[2])
        ]
    }
    if (Array.isArray(component.originalPosition) && component.originalPosition.length >= 3) {
        return [
            toNumber(component.originalPosition[0]),
            toNumber(component.originalPosition[1]),
            toNumber(component.originalPosition[2])
        ]
    }
    const hasPosition =
        component.position_x !== undefined ||
        component.position_y !== undefined ||
        component.position_z !== undefined
    if (hasPosition) {
        return [
            toNumber(component.position_x),
            toNumber(component.position_y),
            toNumber(component.position_z)
        ]
    }
    return [0, 0, 0]
}

const normalizeComponent = (component, index = 0) => {
    const name =
        component?.name ||
        component?.component_name ||
        component?.component_position ||
        `Comp ${index + 1}`
    const coord = readComponentCoord(component)
    const isTowerSide =
        component?.isTowerSide ||
        component?.component_position === TOWER_SMALL_NAME ||
        component?.component_position === TOWER_LARGE_NAME ||
        name === TOWER_SMALL_NAME ||
        name === TOWER_LARGE_NAME
    return {
        id: component?.id ?? `${Date.now()}-${Math.random()}`,
        order: component?.order ?? index + 1,
        name,
        originalPosition: coord,
        component_position: component?.component_position ?? (isTowerSide ? name : ''),
        component_phase: component?.component_phase ?? '',
        component_type: component?.component_type ?? '',
        component_name: component?.component_name ?? name,
        tower_side: component?.tower_side ?? '',
        isTowerSide
    }
}

const buildInstanceCategoryDict = (categories, instances) => {
    if (!categories || !instances) return {}
    if (categories.length !== instances.length) return {}
    const result = {}
    for (let i = 0; i < instances.length; i++) {
        const inst = instances[i]
        if (result[inst] === undefined) {
            result[inst] = categories[i]
        }
    }
    return result
}

const logAttributeStats = (label, attr) => {
    if (!attr || !attr.value) {
        console.log(`[LAS] ${label}: <missing>`)
        return
    }
    const values = attr.value
    const len = values.length
    const sampleCount = Math.min(len, 10)
    const sample = Array.from(values.slice(0, sampleCount))
    let min = Infinity
    let max = -Infinity
    const inspectCount = Math.min(len, 100000)
    for (let i = 0; i < inspectCount; i++) {
        const v = values[i]
        if (!Number.isFinite(v)) continue
        if (v < min) min = v
        if (v > max) max = v
    }
    if (min === Infinity) {
        min = null
        max = null
    }
    console.log(`[LAS] ${label}: len=${len} ctor=${values.constructor.name} size=${attr.size || 1} min=${min} max=${max} sample=${JSON.stringify(sample)}`)
}

const extractExtraAttributes = async (file) => {
    if (!file) return null
    const buffer = await file.arrayBuffer()
    const las = new LASFile(buffer)
    las.open()
    const header = las.getHeader()
    const baseSize = BASE_POINT_SIZES[header.pointsFormatId] ?? header.pointsStructSize
    const extraSize = header.pointsStructSize - baseSize
    if (extraSize < 4) {
        las.close()
        return null
    }

    const total = header.pointsCount
    const instance = new Uint32Array(total)
    const hasCategory = extraSize >= 6
    const category = hasCategory ? new Uint16Array(total) : null

    let read = 0
    while (true) {
        const chunk = las.readData(1000 * 100, 0, 1)
        const view = new DataView(chunk.buffer)
        for (let i = 0; i < chunk.count; i++) {
            const baseOffset = i * header.pointsStructSize + baseSize
            instance[read + i] = view.getUint32(baseOffset, true)
            if (category) {
                category[read + i] = view.getUint16(baseOffset + 4, true)
            }
        }
        read += chunk.count
        if (!chunk.hasMoreData || read >= total) break
    }
    las.close()

    return {
        instance,
        category,
        baseSize,
        extraSize,
        pointsCount: total,
        pointsFormatId: header.pointsFormatId
    }
}

// Custom Shader Logic
const setupShader = (shader) => {
    shader.uniforms.uMode = { value: 0 }

    // Vertex Shader
    shader.vertexShader = `
        attribute float classification;
        attribute float instance;
        varying float vClassification;
        varying float vInstance;
        ${shader.vertexShader}
    `.replace(
        '#include <color_vertex>',
        `
        #include <color_vertex>
        vClassification = classification;
        vInstance = instance;
        `
    )

    // Fragment Shader
    shader.fragmentShader = `
        uniform int uMode;
        varying float vClassification;
        varying float vInstance;

        vec3 getCategoryColor(float cat) {
            // Qt Defaults: 1=Background, 2=Tower, 3=Insulator, 4=Line
            if (cat == 1.0) return vec3(0.5, 0.5, 0.5); // Gray
            if (cat == 2.0) return vec3(1.0, 0.0, 0.0); // Red
            if (cat == 3.0) return vec3(0.0, 1.0, 0.0); // Green
            if (cat == 4.0) return vec3(0.0, 1.0, 1.0); // Cyan
            return vec3(0.3, 0.3, 0.3); // Default dark gray
        }

        vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }

        vec3 getInstanceColor(float id) {
             if (id == 0.0) return vec3(0.3);
             float hue = fract(id * 0.61803398875);
             float sat = 0.85;
             float val = 0.95;
             return hsv2rgb(vec3(hue, sat, val));
        }

        ${shader.fragmentShader}
    `.replace(
        '#include <color_fragment>',
        `
        if (uMode == 1) {
            diffuseColor.rgb = getCategoryColor(vClassification);
        } else if (uMode == 2) {
            diffuseColor.rgb = getInstanceColor(vInstance);
        } else {
             #ifdef USE_COLOR
                diffuseColor.rgb *= vColor;
             #endif
        }
        `
    )
}

function PointCloud({ data, onPick, viewMode, pointSize, componentAddMode, onSetTarget }) {
    const pointsRef = useRef()
    const materialRef = useRef()
    const handleBeforeCompile = useCallback((shader) => {
        setupShader(shader)
        if (materialRef.current) {
            materialRef.current.userData.shader = shader
        }
    }, [])

    const geometry = useMemo(() => {
        if (!data) return null
        const header = data.header
        const attributes = data.attributes
        // Fix: Use vertexCount if totalPoints is undefined
        const totalPoints = header.vertexCount || header.totalPoints || attributes.POSITION.value.length / 3

        const geom = new THREE.BufferGeometry()

        // 1. Handle Positions
        if (attributes.POSITION) {
            const positions = attributes.POSITION.value
            // Fix: Use boundingBox if mins is undefined
            let offset = [0, 0, 0]
            if (header.boundingBox) {
                offset = header.boundingBox[0]
            } else if (header.mins) {
                offset = [header.mins[0], header.mins[1], header.mins[2]]
            } else if (positions.length >= 3) {
                offset = [positions[0], positions[1], positions[2]]
            }

            const centeredPositions = new Float32Array(totalPoints * 3)
            for (let i = 0; i < totalPoints; i++) {
                centeredPositions[i * 3] = positions[i * 3] - offset[0]
                centeredPositions[i * 3 + 1] = positions[i * 3 + 1] - offset[1]
                centeredPositions[i * 3 + 2] = positions[i * 3 + 2] - offset[2]
            }

            geom.setAttribute('position', new THREE.BufferAttribute(centeredPositions, 3))
            geom.userData.offset = offset
            geom.computeBoundingSphere()
        }

        // 2. Handle Colors (RGB)
        if (attributes.COLOR_0) {
            const colors = attributes.COLOR_0.value
            // Determine stride (3 or 4)
            const stride = Math.floor(colors.length / totalPoints) >= 4 ? 4 : 3

            const is16Bit = colors.some(c => c > 255)
            const scale = is16Bit ? 1.0 / 65535.0 : 1.0 / 255.0

            // Still output RGB (3 components) to Three.js
            const normalizedColors = new Float32Array(totalPoints * 3)

            if (stride >= 4) {
                for (let i = 0; i < totalPoints; i++) {
                    normalizedColors[i * 3] = colors[i * 4] * scale
                    normalizedColors[i * 3 + 1] = colors[i * 4 + 1] * scale
                    normalizedColors[i * 3 + 2] = colors[i * 4 + 2] * scale
                }
            } else {
                for (let i = 0; i < totalPoints * 3; i++) {
                    normalizedColors[i] = colors[i] * scale
                }
            }

            geom.setAttribute('color', new THREE.BufferAttribute(normalizedColors, 3))
        } else {
            const colors = new Float32Array(totalPoints * 3).fill(1.0)
            geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        }

        // 3. Handle Classification
        const classification = attributes.classification || attributes.Classification || attributes.CLASSIFICATION || attributes.label || attributes.Label
        if (classification) {
            const classValues = classification.value
            const classArray = classValues instanceof Float32Array
                ? classValues
                : new Float32Array(classValues)
            geom.setAttribute('classification', new THREE.BufferAttribute(classArray, classification.size || 1))
        } else {
            // Default 0
            geom.setAttribute('classification', new THREE.BufferAttribute(new Float32Array(totalPoints).fill(0), 1))
        }

        // 4. Handle Instance
        const instance = attributes.instance || attributes.Instance || attributes.INSTANCE || attributes.User_Data || attributes.user_data || attributes.point_source_id
        if (instance) {
            const instanceValues = instance.value
            const instanceArray = instanceValues instanceof Float32Array
                ? instanceValues
                : new Float32Array(instanceValues)
            geom.setAttribute('instance', new THREE.BufferAttribute(instanceArray, instance.size || 1))
        } else {
            geom.setAttribute('instance', new THREE.BufferAttribute(new Float32Array(totalPoints).fill(0), 1))
        }

        return geom
    }, [data])

    // Update Uniforms
    useFrame(() => {
        if (materialRef.current && materialRef.current.userData.shader) {
            materialRef.current.userData.shader.uniforms.uMode.value = viewMode
        }
    })

    // Camera auto-center
    const { controls, raycaster } = useThree()
    useEffect(() => {
        if (geometry && geometry.boundingSphere && controls) {
            controls.target.copy(geometry.boundingSphere.center)
            controls.update()
        }
    }, [geometry, controls])

    useEffect(() => {
        if (!raycaster?.params?.Points) return
        raycaster.params.Points.threshold = Math.max(0.05, pointSize * 0.5)
        raycaster.firstHitOnly = true
    }, [pointSize, raycaster])

    useEffect(() => {
        if (!geometry) return
        const clsAttr = geometry.getAttribute('classification')
        const instAttr = geometry.getAttribute('instance')
        const posAttr = geometry.getAttribute('position')
        console.log(`[Geometry] position count=${posAttr?.count ?? 0}`)
        console.log(`[Geometry] classification attr=${clsAttr ? 'yes' : 'no'} instance attr=${instAttr ? 'yes' : 'no'}`)
        if (instAttr) {
            const values = instAttr.array
            const sample = Array.from(values.slice(0, Math.min(values.length, 10)))
            console.log(`[Geometry] instance sample=${JSON.stringify(sample)}`)
        }
    }, [geometry])

    // Raycasting for point picking
    const handlePointerDown = useCallback((e) => {
        const allowPick = componentAddMode ? e.metaKey : (e.ctrlKey || e.metaKey)
        if (!allowPick) return
        if (e.detail && e.detail > 1) return
        if (!geometry) return
        e.stopPropagation()
        if (e.index !== undefined) {
            const point = new THREE.Vector3()
            point.fromBufferAttribute(geometry.attributes.position, e.index)

            // Convert back to original coordinates for display/saving
            const originalPoint = [
                point.x + geometry.userData.offset[0],
                point.y + geometry.userData.offset[1],
                point.z + geometry.userData.offset[2]
            ]

            onPick({
                position: point, // Local position for rendering marker
                originalPosition: originalPoint,
                index: e.index
            })
        }
    }, [componentAddMode, geometry, onPick])

    const handleDoubleClick = useCallback((e) => {
        if (!onSetTarget || !geometry) return
        if (e.index === undefined) return
        e.stopPropagation()
        const point = new THREE.Vector3()
        point.fromBufferAttribute(geometry.attributes.position, e.index)
        onSetTarget(point)
    }, [geometry, onSetTarget])

    if (!geometry) return null

    return (
        <points
            ref={pointsRef}
            geometry={geometry}
            onClick={handlePointerDown}
            onDoubleClick={handleDoubleClick}
        >
            <pointsMaterial
                ref={materialRef}
                size={pointSize}
                vertexColors={true}
                sizeAttenuation={true}
                onBeforeCompile={handleBeforeCompile}
            />
        </points>
    )
}

function ComponentMarkers({ components, onDelete, offset, selectedIndex, onSelect, markerSize }) {
    // ... existing impl ...
    if (!offset) return null

    return (
        <group>
            {components.map((comp, idx) => {
                let pos = null
                if (comp.originalPosition) {
                    pos = new THREE.Vector3(
                        comp.originalPosition[0] - offset[0],
                        comp.originalPosition[1] - offset[1],
                        comp.originalPosition[2] - offset[2]
                    )
                } else if (comp.position) {
                    pos = comp.position
                }
                if (!pos) return null

                const isSelected = idx === selectedIndex
                const isTowerSide =
                    comp.isTowerSide ||
                    comp.component_position === TOWER_SMALL_NAME ||
                    comp.component_position === TOWER_LARGE_NAME ||
                    comp.name === TOWER_SMALL_NAME ||
                    comp.name === TOWER_LARGE_NAME
                const markerColor = isSelected ? '#f1c40f' : (isTowerSide ? '#2ecc71' : 'magenta')
                const radius = Math.max(0.05, (markerSize || 0.4) * (isSelected ? 1.35 : 1.0))
                const labelHeight = radius * 1.4 + 0.3

                return (
                    <group key={idx} position={pos}>
                        <mesh
                            onPointerDown={(e) => {
                                e.stopPropagation()
                                if (onSelect) onSelect(idx)
                            }}
                        >
                            <sphereGeometry args={[radius, 16, 16]} />
                            <meshBasicMaterial color={markerColor} depthTest={false} transparent opacity={0.85} />
                        </mesh>
                        <Html position={[0, labelHeight, 0]} style={{ pointerEvents: 'none' }}>
                            <div style={{
                                background: isSelected ? 'rgba(241,196,15,0.85)' : 'rgba(0,0,0,0.6)',
                                color: '#fff',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                whiteSpace: 'nowrap'
                            }}>
                                {comp.name || comp.component_name || 'Component'}
                            </div>
                        </Html>
                    </group>
                )
            })}
        </group>
    )
}

function Scene({
    lasData,
    components,
    viewMode,
    pointSize,
    componentAddMode,
    selectedComponentIndex,
    setSelectedComponentIndex,
    onDeleteComponent,
    componentPointSize,
    onRequestAddComponent
}) {
    console.log('Scene: Render start. lasData:', !!lasData, 'Components:', components.length)
    const controlsRef = useRef()

    // Calculate offset from LAS header
    const offset = useMemo(() => {
        if (!lasData) {
            console.log('Scene: No lasData, returning [0,0,0] offset')
            return [0, 0, 0]
        }
        const header = lasData.header
        let off = [0, 0, 0]
        if (header.boundingBox) off = header.boundingBox[0]
        else if (header.mins) off = [header.mins[0], header.mins[1], header.mins[2]]
        else if (lasData.attributes && lasData.attributes.POSITION && lasData.attributes.POSITION.value.length >= 3) {
            const pos = lasData.attributes.POSITION.value
            off = [pos[0], pos[1], pos[2]]
        }
        console.log('Scene: Calculated Offset:', off)

        // Debug first point
        if (lasData.attributes && lasData.attributes.POSITION) {
            const p = lasData.attributes.POSITION.value
            console.log('Scene: First Point Raw:', p[0], p[1], p[2])
        }

        return off
    }, [lasData])

    // Debug Component Position
    useEffect(() => {
        if (components.length > 0) {
            const c = components[0]
            if (c.originalPosition) {
                const local = [
                    c.originalPosition[0] - offset[0],
                    c.originalPosition[1] - offset[1],
                    c.originalPosition[2] - offset[2]
                ]
                console.log('Scene: First Component Transformation:',
                    'Name:', c.name,
                    'Original:', c.originalPosition,
                    'Offset:', offset,
                    'Calculated Local:', local
                )
            }
        }
    }, [components, offset])

    const handlePick = (pickData) => {
        if (onRequestAddComponent) {
            onRequestAddComponent(pickData)
        }
    }

    const handleSetTarget = useCallback((target) => {
        if (!controlsRef.current) return
        controlsRef.current.target.copy(target)
        controlsRef.current.update()
    }, [])

    return (
        <>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} />
            <OrbitControls ref={controlsRef} makeDefault />
            <gridHelper args={[100, 100]} />
            <axesHelper args={[5]} />
            <axesHelper args={[5]} />
            <PointCloud
                data={lasData}
                onPick={handlePick}
                viewMode={viewMode}
                pointSize={pointSize}
                componentAddMode={componentAddMode}
                onSetTarget={handleSetTarget}
            />
            <ComponentMarkers
                components={components}
                onDelete={onDeleteComponent}
                offset={offset}
                selectedIndex={selectedComponentIndex}
                onSelect={setSelectedComponentIndex}
                markerSize={componentPointSize}
            />
        </>
    )
}

function App() {
    const [lasData, setLasData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [fileName, setFileName] = useState('')
    const [components, setComponents] = useState([])
    const [componentAddMode, setComponentAddMode] = useState(false)
    const [selectedComponentIndex, setSelectedComponentIndex] = useState(-1)
    const [nudgeStep, setNudgeStep] = useState(0.1)
    const [componentPointSize, setComponentPointSize] = useState(0.4)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [labelMeta, setLabelMeta] = useState({
        voltage_level: '',
        tower_type1: '',
        tower_type2: '',
        transmission_type: '',
        num_circuit: ''
    })
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [pendingPick, setPendingPick] = useState(null)
    const [selectedLoop, setSelectedLoop] = useState('')
    const [selectedPhase, setSelectedPhase] = useState('')
    const [selectedPosition, setSelectedPosition] = useState('')
    const [selectedComponentType, setSelectedComponentType] = useState('')
    const [fileList, setFileList] = useState([]) // List of { name, lasFile, jsonFile }
    const [currentFileIndex, setCurrentFileIndex] = useState(-1)

    // 0 = RGB, 1 = Classification, 2 = Instance
    const [viewMode, setViewMode] = useState(0)
    const [pointSize, setPointSize] = useState(0.5)

    useEffect(() => {
        const handleKeyDown = (e) => {
            const activeTag = document.activeElement?.tagName
            const isEditing =
                activeTag === 'INPUT' ||
                activeTag === 'TEXTAREA' ||
                document.activeElement?.isContentEditable
            if (isEditing) return

            if (e.key === 'Escape') {
                if (addDialogOpen) {
                    e.preventDefault()
                    setAddDialogOpen(false)
                    setPendingPick(null)
                    setSelectedLoop('')
                    setSelectedPhase('')
                    setSelectedPosition('')
                    setSelectedComponentType('')
                    return
                }
                if (componentAddMode) {
                    e.preventDefault()
                    setComponentAddMode(false)
                }
                return
            }

            if (selectedComponentIndex < 0) return

            let axis = null
            let direction = 0
            if (e.key === 'ArrowLeft') {
                axis = 0
                direction = -1
            } else if (e.key === 'ArrowRight') {
                axis = 0
                direction = 1
            } else if (e.key === 'ArrowUp') {
                axis = e.ctrlKey ? 2 : 1
                direction = 1
            } else if (e.key === 'ArrowDown') {
                axis = e.ctrlKey ? 2 : 1
                direction = -1
            }

            if (axis === null) return
            e.preventDefault()

            setComponents((prev) => {
                if (selectedComponentIndex >= prev.length) return prev
                const next = [...prev]
                const current = { ...next[selectedComponentIndex] }
                const coord = readComponentCoord(current)
                coord[axis] = toNumber(coord[axis]) + nudgeStep * direction
                current.originalPosition = coord
                next[selectedComponentIndex] = current
                return next
            })
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [addDialogOpen, componentAddMode, nudgeStep, selectedComponentIndex])

    // Helper to load specific files
    const loadFiles = async (lasFile, jsonFile) => {
        setLoading(true)
        setError(null)
        setFileName(lasFile.name)
        setLasData(null) // Clear previous data first
        setComponents([])
        setComponentAddMode(false)
        setSelectedComponentIndex(-1)
        setLabelMeta({
            voltage_level: '',
            tower_type1: '',
            tower_type2: '',
            transmission_type: '',
            num_circuit: ''
        })
        setAddDialogOpen(false)
        setPendingPick(null)
        setSelectedLoop('')
        setSelectedPhase('')
        setSelectedPosition('')
        setSelectedComponentType('')

        try {
            console.log('Starting load...', lasFile.name)
            // Use worker: false to avoid WASM issues
            const data = await load(lasFile, LASLoader, {
                las: { skip: 1 },
                worker: false
            })

            // Default: if LAS has classification, use it.
            // If JSON has categories/instances, OVERRIDE or ADD them.

            if (jsonFile) {
                console.log('App: Loading JSON...', jsonFile.name)
                const text = await jsonFile.text()
                console.log('App: JSON text length:', text.length)
                const json = JSON.parse(text)

                const meta = {
                    voltage_level: json.voltage_level ?? null,
                    tower_type1: json.tower_type1 ?? json.tower_type ?? null,
                    tower_type2: json.tower_type2 ?? json.tower_shape ?? null,
                    transmission_type: json.transmission_type ?? null,
                    num_circuit: json.num_circuit ?? null,
                    'point cloud file': json['point cloud file'] ?? null,
                    category_dict: json.category_dict ?? null,
                    instance_category_dict: json.instance_category_dict ?? null
                }
                if (meta.transmission_type !== null) {
                    meta.transmission_type = normalizeTransmissionType(meta.transmission_type)
                }
                if (meta.num_circuit !== null && meta.num_circuit !== undefined && meta.num_circuit !== '') {
                    const parsed = Number.parseInt(meta.num_circuit, 10)
                    meta.num_circuit = Number.isFinite(parsed) ? parsed : meta.num_circuit
                }
                const cleanedMeta = Object.fromEntries(
                    Object.entries(meta).filter(([, value]) => value !== null && value !== undefined && value !== '')
                )
                setLabelMeta(prev => ({
                    ...prev,
                    ...cleanedMeta
                }))

                // Parse Categories (Classification) from JSON
                const jsonCategories = Array.isArray(json.categories)
                    ? json.categories
                    : (Array.isArray(json.categorys) ? json.categorys : null)
                if (jsonCategories) {
                    data.attributes.classification = {
                        value: new Uint8Array(jsonCategories),
                        size: 1
                    }
                    console.log('Loaded Categories from JSON:', jsonCategories.length)
                }

                // Parse Instances from JSON
                if (Array.isArray(json.instances)) {
                    data.attributes.instance = {
                        value: new Int32Array(json.instances),
                        size: 1
                    }
                    console.log('Loaded Instances from JSON:', json.instances.length)
                }

                // Handle component format (array or object)
                const normalizedComponents = []
                const rawComponents = Array.isArray(json.components)
                    ? json.components
                    : (json.components && typeof json.components === 'object' ? Object.values(json.components) : [])
                rawComponents.forEach((comp) => {
                    normalizedComponents.push(normalizeComponent(comp, normalizedComponents.length))
                })

                const towerComponents = []
                if (Array.isArray(json.small_tower_coord)) {
                    towerComponents.push(normalizeComponent({
                        name: TOWER_SMALL_NAME,
                        component_position: TOWER_SMALL_NAME,
                        component_name: TOWER_SMALL_NAME,
                        coord: json.small_tower_coord,
                        isTowerSide: true
                    }, towerComponents.length))
                }
                if (Array.isArray(json.large_tower_coord)) {
                    towerComponents.push(normalizeComponent({
                        name: TOWER_LARGE_NAME,
                        component_position: TOWER_LARGE_NAME,
                        component_name: TOWER_LARGE_NAME,
                        coord: json.large_tower_coord,
                        isTowerSide: true
                    }, towerComponents.length))
                }

                const mergedComponents = [...towerComponents, ...normalizedComponents]
                if (mergedComponents.length > 0) {
                    setComponents(mergedComponents)
                    console.log('App: Set components from list:', mergedComponents.length)
                }
            } else {
                console.warn('App: No JSON file provided for components.')
            }

            const hasInstanceAttr = !!data.attributes?.instance
            if (!hasInstanceAttr) {
                try {
                    console.log('[LAS] Attempting to read extra bytes for instance...')
                    const extra = await extractExtraAttributes(lasFile)
                    if (extra?.instance) {
                        data.attributes.instance = { value: extra.instance, size: 1 }
                        console.log(`[LAS] Extra instance loaded: count=${extra.pointsCount} baseSize=${extra.baseSize} extraSize=${extra.extraSize}`)
                    } else {
                        console.warn('[LAS] No extra instance data found.')
                    }
                    if (extra?.category) {
                        const classificationAttr = data.attributes?.classification
                        let maxClass = 0
                        if (classificationAttr?.value) {
                            const values = classificationAttr.value
                            for (let i = 0; i < values.length; i++) {
                                if (values[i] > maxClass) maxClass = values[i]
                            }
                        }
                        if (maxClass === 0) {
                            data.attributes.classification = { value: extra.category, size: 1 }
                            console.log('[LAS] Replaced classification with extra category bytes')
                        }
                    }
                } catch (err) {
                    console.warn('[LAS] Failed to read extra bytes:', err)
                }
            }

            console.log('[LAS] Attribute check before setLasData')
            logAttributeStats('classification', data.attributes?.classification)
            logAttributeStats('instance', data.attributes?.instance)
            logAttributeStats('User_Data', data.attributes?.User_Data)
            logAttributeStats('point_source_id', data.attributes?.point_source_id)

            setLasData(data)
            console.log('App: detailed load complete. Data set.')

        } catch (err) {
            console.error('App: Load Error:', err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleFileChange = (event) => {
        const files = event.target.files
        if (!files || files.length === 0) return

        const fileArr = Array.from(files)

        // Check if it's a folder upload (detected by looking at paths or just multiple files)
        // Simplest logic: Group files by name
        const lasFiles = fileArr.filter(f => f.name.toLowerCase().endsWith('.las') || f.name.toLowerCase().endsWith('.laz'))
        const jsonFiles = fileArr.filter(f => f.name.toLowerCase().endsWith('.json'))

        if (lasFiles.length === 0 && jsonFiles.length === 0) return

        if (lasFiles.length === 1 && jsonFiles.length <= 1 && !event.target.webkitdirectory) {
            // Single file mode (manual selection)
            loadFiles(lasFiles[0], jsonFiles[0])
            setFileList([])
            setCurrentFileIndex(-1)
        } else {
            // Folder/Multi-file mode: Build file list
            const newFileList = lasFiles.map(las => {
                const baseName = las.name.substring(0, las.name.lastIndexOf('.'))
                // Find matching JSON (case-insensitive base name match)
                const json = jsonFiles.find(j =>
                    j.name.toLowerCase() === baseName.toLowerCase() + '.json'
                )
                if (json) console.log('App: Matched JSON for', las.name, '->', json.name)
                else console.log('App: No matching JSON for', las.name)

                return { name: las.name, lasFile: las, jsonFile: json }
            })

            newFileList.sort((a, b) => a.name.localeCompare(b.name))
            setFileList(newFileList)

            if (newFileList.length > 0) {
                setCurrentFileIndex(0)
                loadFiles(newFileList[0].lasFile, newFileList[0].jsonFile)
            }
        }
    }

    const handleSelectFile = (index) => {
        if (index < 0 || index >= fileList.length) return
        setCurrentFileIndex(index)
        const item = fileList[index]
        loadFiles(item.lasFile, item.jsonFile)
    }

    const exportJSON = () => {
        if (!lasData) return

        let smallTowerCoord = null
        let largeTowerCoord = null

        const exportedComponents = components.flatMap((comp, idx) => {
            const coord = readComponentCoord(comp)
            const name = comp.component_name || comp.name || `Comp ${idx + 1}`
            const compMarker = comp.component_position || name

            if (comp.isTowerSide || compMarker === TOWER_SMALL_NAME || compMarker === TOWER_LARGE_NAME) {
                if (compMarker === TOWER_SMALL_NAME && !smallTowerCoord) smallTowerCoord = coord
                if (compMarker === TOWER_LARGE_NAME && !largeTowerCoord) largeTowerCoord = coord
                return []
            }

            return [{
                id: comp.id ?? idx + 1,
                order: comp.order ?? idx + 1,
                coord,
                position_x: coord[0],
                position_y: coord[1],
                position_z: coord[2],
                tower_side: comp.tower_side ?? '',
                component_phase: comp.component_phase ?? '',
                component_position: comp.component_position ?? '',
                component_type: comp.component_type ?? '',
                component_name: name
            }]
        })

        const cleanedMeta = Object.fromEntries(
            Object.entries(labelMeta).filter(([, value]) => value !== null && value !== undefined && value !== '')
        )
        const data = {
            ...cleanedMeta,
            components: exportedComponents
        }

        if (smallTowerCoord) data.small_tower_coord = smallTowerCoord
        if (largeTowerCoord) data.large_tower_coord = largeTowerCoord

        Object.keys(data).forEach((key) => {
            if (data[key] === undefined) delete data[key]
        })

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const defaultName = fileName ? fileName.replace(/\.(las|laz)$/i, '.json') : 'annotation.json'
        a.download = defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`
        a.click()
    }

    const deleteComponentAt = useCallback((index) => {
        setComponents((prev) => {
            if (index < 0 || index >= prev.length) return prev
            const next = [...prev]
            next.splice(index, 1)
            return next
        })
        setSelectedComponentIndex((prev) => {
            if (prev === index) return -1
            if (prev > index) return prev - 1
            return prev
        })
    }, [])

    const updateComponentAt = useCallback((index, updates) => {
        setComponents((prev) => {
            if (index < 0 || index >= prev.length) return prev
            const next = [...prev]
            next[index] = { ...next[index], ...updates }
            return next
        })
    }, [])

    const updateComponentCoord = useCallback((index, axis, value) => {
        setComponents((prev) => {
            if (index < 0 || index >= prev.length) return prev
            const next = [...prev]
            const current = { ...next[index] }
            const coord = readComponentCoord(current)
            coord[axis] = Number.isFinite(value) ? value : coord[axis]
            current.originalPosition = coord
            next[index] = current
            return next
        })
    }, [])

    const updateMetaField = useCallback((key, value) => {
        let nextValue = value
        if (key === 'transmission_type') {
            nextValue = normalizeTransmissionType(value)
        }
        if (key === 'num_circuit') {
            if (value === '' || value === null || value === undefined) {
                nextValue = ''
            } else {
                const parsed = Number.parseInt(value, 10)
                nextValue = Number.isFinite(parsed) ? parsed : value
            }
        }
        setLabelMeta(prev => ({
            ...prev,
            [key]: nextValue
        }))
    }, [])

    const isTowerSideSelection =
        selectedPosition === TOWER_SMALL_NAME || selectedPosition === TOWER_LARGE_NAME
    const composedComponentName = useMemo(() => (
        buildComponentName(selectedLoop, selectedPhase, selectedPosition, selectedComponentType)
    ), [selectedLoop, selectedPhase, selectedPosition, selectedComponentType])

    useEffect(() => {
        if (!isTowerSideSelection) return
        setSelectedLoop('')
        setSelectedPhase('')
        setSelectedComponentType('')
    }, [isTowerSideSelection])

    const handleConfirmAdd = useCallback(() => {
        if (!pendingPick) return
        const name = composedComponentName.trim()
        if (!name) return
        const isTowerSide = name === TOWER_SMALL_NAME || name === TOWER_LARGE_NAME || isTowerSideSelection
        const newComponent = normalizeComponent({
            name,
            component_name: name,
            tower_side: isTowerSide ? '' : selectedLoop,
            component_phase: isTowerSide ? '' : selectedPhase,
            component_position: isTowerSide ? name : (selectedPosition || ''),
            component_type: isTowerSide ? '' : selectedComponentType,
            coord: pendingPick.originalPosition,
            isTowerSide
        }, components.length)
        setComponents(prev => [...prev, newComponent])
        setSelectedComponentIndex(components.length)
        setAddDialogOpen(false)
        setPendingPick(null)
        setSelectedLoop('')
        setSelectedPhase('')
        setSelectedPosition('')
        setSelectedComponentType('')
    }, [
        composedComponentName,
        components.length,
        isTowerSideSelection,
        pendingPick,
        selectedComponentType,
        selectedLoop,
        selectedPhase,
        selectedPosition
    ])

    return (
        <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#333' }}>
            {/* Increase camera 'far' to ensure large scenes are visible */}
            <Canvas camera={{ position: [0, 10, 10], fov: 50, far: 100000 }}>
                <Scene
                    lasData={lasData}
                    components={components}
                    viewMode={viewMode}
                    pointSize={pointSize}
                    componentAddMode={componentAddMode}
                    selectedComponentIndex={selectedComponentIndex}
                    setSelectedComponentIndex={setSelectedComponentIndex}
                    onDeleteComponent={deleteComponentAt}
                    componentPointSize={componentPointSize}
                    onRequestAddComponent={(pickData) => {
                        setPendingPick(pickData)
                        setAddDialogOpen(true)
                    }}
                />
            </Canvas>

            {/* Sidebar */}
            <div style={{
                position: 'absolute',
                top: 20,
                left: 20,
                zIndex: 10,
                background: 'rgba(30,30,30,0.85)',
                padding: sidebarCollapsed ? '12px' : '20px',
                borderRadius: '12px',
                color: '#eee',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                backdropFilter: 'blur(10px)',
                width: sidebarCollapsed ? '54px' : '320px',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                gap: '15px',
                overflow: 'hidden'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#fff', whiteSpace: 'nowrap' }}>
                        {sidebarCollapsed ? 'PSAT' : 'PSAT Web'}
                    </h2>
                    <button
                        onClick={() => setSidebarCollapsed(prev => !prev)}
                        style={{
                            background: '#444',
                            border: 'none',
                            color: '#fff',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.8rem'
                        }}
                        title={sidebarCollapsed ? 'Expand Panel' : 'Collapse Panel'}
                    >
                        {sidebarCollapsed ? '>>' : '<<'}
                    </button>
                </div>

                {sidebarCollapsed ? (
                    <div style={{ fontSize: '0.75rem', color: '#aaa', textAlign: 'center' }}>Panel</div>
                ) : (
                    <div style={{ overflowY: 'auto', minHeight: 0, flex: 1, paddingRight: '4px' }}>
                {/* Controls: Point Size */}
                <div style={{ paddingBottom: '10px', borderBottom: '1px solid #444' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', color: '#aaa', fontWeight: 600 }}>
                        POINT SIZE: {pointSize.toFixed(1)}
                    </label>
                    <input
                        type="range"
                        min="0.1"
                        max="5.0"
                        step="0.1"
                        value={pointSize}
                        onChange={(e) => setPointSize(parseFloat(e.target.value))}
                        style={{ width: '100%' }}
                    />
                </div>

                {/* Controls: View Mode */}
                <div style={{ paddingBottom: '10px', borderBottom: '1px solid #444' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', color: '#aaa', fontWeight: 600 }}>
                        VIEW MODE
                    </label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                        <button onClick={() => setViewMode(0)} style={{
                            flex: 1, padding: '6px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                            background: viewMode === 0 ? '#228be6' : '#444', color: 'white', fontSize: '0.8rem'
                        }}>RGB</button>
                        <button onClick={() => setViewMode(1)} style={{
                            flex: 1, padding: '6px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                            background: viewMode === 1 ? '#228be6' : '#444', color: 'white', fontSize: '0.8rem'
                        }}>Class</button>
                        <button onClick={() => setViewMode(2)} style={{
                            flex: 1, padding: '6px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                            background: viewMode === 2 ? '#228be6' : '#444', color: 'white', fontSize: '0.8rem'
                        }}>Instance</button>
                    </div>
                </div>

                {/* Metadata */}
                <div style={{ paddingBottom: '10px', borderBottom: '1px solid #444' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', color: '#aaa', fontWeight: 600 }}>
                        METADATA
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
                        <select
                            value={labelMeta.voltage_level || ''}
                            onChange={(e) => updateMetaField('voltage_level', e.target.value)}
                            style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '6px' }}
                        >
                            {VOLTAGE_LEVEL_OPTIONS.map(option => (
                                <option key={`voltage-${option || 'none'}`} value={option}>
                                    {option || '电压等级'}
                                </option>
                            ))}
                        </select>
                        <select
                            value={labelMeta.tower_type1 || ''}
                            onChange={(e) => updateMetaField('tower_type1', e.target.value)}
                            style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '6px' }}
                        >
                            {TOWER_TYPE1_OPTIONS.map(option => (
                                <option key={`tower1-${option || 'none'}`} value={option}>
                                    {option || '塔型1'}
                                </option>
                            ))}
                        </select>
                        <select
                            value={labelMeta.tower_type2 || ''}
                            onChange={(e) => updateMetaField('tower_type2', e.target.value)}
                            style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '6px' }}
                        >
                            {TOWER_TYPE2_OPTIONS.map(option => (
                                <option key={`tower2-${option || 'none'}`} value={option}>
                                    {option || '塔型2'}
                                </option>
                            ))}
                        </select>
                        <select
                            value={labelMeta.transmission_type || ''}
                            onChange={(e) => updateMetaField('transmission_type', e.target.value)}
                            style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '6px' }}
                        >
                            {TRANSMISSION_TYPE_OPTIONS.map(option => (
                                <option key={`trans-${option || 'none'}`} value={option}>
                                    {option || '输电类型'}
                                </option>
                            ))}
                        </select>
                        <select
                            value={
                                labelMeta.num_circuit === null || labelMeta.num_circuit === undefined || labelMeta.num_circuit === ''
                                    ? ''
                                    : String(labelMeta.num_circuit)
                            }
                            onChange={(e) => updateMetaField('num_circuit', e.target.value)}
                            style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '6px' }}
                        >
                            {NUM_CIRCUIT_OPTIONS.map(option => (
                                <option key={`circuit-${option || 'none'}`} value={option}>
                                    {option || '回数'}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* File Loaders */}
                <div style={{ paddingBottom: '10px', borderBottom: '1px solid #444' }}>
                    <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#aaa', fontWeight: 600 }}>
                            OPEN FILES (Multi-select)
                        </label>
                        <input
                            type="file"
                            multiple
                            accept=".las,.laz,.json"
                            onChange={handleFileChange}
                            style={{ width: '100%', fontSize: '0.8rem' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: '#aaa', fontWeight: 600 }}>
                            OPEN FOLDER
                        </label>
                        <input
                            type="file"
                            webkitdirectory=""
                            directory=""
                            onChange={handleFileChange}
                            style={{ width: '100%', fontSize: '0.8rem' }}
                        />
                    </div>
                </div>

                {/* File List (if multiple) */}
                {fileList.length > 0 && (
                    <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                        {fileList.map((f, i) => (
                            <div key={i}
                                onClick={() => handleSelectFile(i)}
                                style={{
                                    padding: '4px 8px',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer',
                                    background: i === currentFileIndex ? '#228be6' : 'transparent',
                                    color: i === currentFileIndex ? 'white' : '#ccc',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}>
                                {f.name} {f.jsonFile ? '✅' : ''}
                            </div>
                        ))}
                    </div>
                )}

                {/* Status */}
                {loading && <div style={{ color: '#4dabf7', fontWeight: 'bold', fontSize: '0.9rem' }}>Loading {fileName}...</div>}
                {error && <div style={{ color: '#ff6b6b', fontSize: '0.9rem' }}>Error: {error}</div>}

                {/* Component List */}
                {lasData && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
                            <h4 style={{ margin: 0 }}>Components ({components.length})</h4>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                <button
                                    onClick={() => setComponentAddMode((prev) => !prev)}
                                    style={{
                                        background: componentAddMode ? '#2ecc71' : '#444',
                                        border: 'none',
                                        color: 'white',
                                        padding: '5px 10px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem'
                                    }}
                                >
                                    {componentAddMode ? 'Add Mode: On' : 'Add Component'}
                                </button>
                                {componentAddMode && (
                                    <button
                                        onClick={() => setComponentAddMode(false)}
                                        style={{
                                            background: '#ff6b6b',
                                            border: 'none',
                                            color: 'white',
                                            padding: '5px 10px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem'
                                        }}
                                    >
                                        Exit Mode
                                    </button>
                                )}
                                <button onClick={exportJSON} style={{
                                    background: '#228be6',
                                    border: 'none',
                                    color: 'white',
                                    padding: '5px 10px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem'
                                }}>Save JSON</button>
                            </div>
                        </div>

                        <div style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: '8px' }}>
                            {componentAddMode
                                ? 'Add mode: Cmd + Click to choose name • ESC to exit'
                                : 'Tip: Cmd/Ctrl + Click to add component • Double Click sets rotation center'}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: '#bbb', fontSize: '0.8rem' }}>
                            <span>Step</span>
                            <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={nudgeStep}
                                onChange={(e) => setNudgeStep(toNumber(e.target.value, 0.1))}
                                style={{
                                    width: '80px',
                                    background: '#222',
                                    color: '#fff',
                                    border: '1px solid #444',
                                    borderRadius: '4px',
                                    padding: '4px 6px'
                                }}
                            />
                            <span>Arrow keys move selected (Ctrl+↑/↓ for Z)</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: '#bbb', fontSize: '0.8rem' }}>
                            <span>Marker Size</span>
                            <input
                                type="range"
                                min="0.1"
                                max="2.0"
                                step="0.05"
                                value={componentPointSize}
                                onChange={(e) => setComponentPointSize(parseFloat(e.target.value))}
                                style={{ flex: 1 }}
                            />
                            <span style={{ minWidth: '36px', textAlign: 'right' }}>{componentPointSize.toFixed(2)}</span>
                        </div>

                        <div style={{ maxHeight: '320px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                            {components.length === 0 && <div style={{ padding: '10px', color: '#666', textAlign: 'center' }}>No components added</div>}
                            {components.map((comp, i) => {
                                const coord = readComponentCoord(comp)
                                const isSelected = i === selectedComponentIndex
                                return (
                                    <div
                                        key={i}
                                        onClick={() => setSelectedComponentIndex(i)}
                                        style={{
                                            padding: '8px',
                                            borderBottom: '1px solid #444',
                                            background: isSelected ? 'rgba(35, 55, 75, 0.6)' : 'transparent',
                                            borderLeft: isSelected ? '3px solid #f1c40f' : '3px solid transparent'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <input
                                                type="text"
                                                value={comp.name || comp.component_name || ''}
                                                onChange={(e) => updateComponentAt(i, { name: e.target.value, component_name: e.target.value })}
                                                onFocus={() => setSelectedComponentIndex(i)}
                                                style={{
                                                    flex: 1,
                                                    background: '#222',
                                                    color: '#fff',
                                                    border: '1px solid #444',
                                                    borderRadius: '4px',
                                                    padding: '4px 6px',
                                                    fontSize: '0.85rem'
                                                }}
                                            />
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    deleteComponentAt(i)
                                                }}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: '#ff6b6b',
                                                    cursor: 'pointer',
                                                    fontSize: '1.1rem',
                                                    lineHeight: 1
                                                }}
                                            >×</button>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginTop: '6px' }}>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={coord[0]}
                                                onChange={(e) => updateComponentCoord(i, 0, Number.parseFloat(e.target.value))}
                                                onFocus={() => setSelectedComponentIndex(i)}
                                                style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '4px 6px' }}
                                            />
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={coord[1]}
                                                onChange={(e) => updateComponentCoord(i, 1, Number.parseFloat(e.target.value))}
                                                onFocus={() => setSelectedComponentIndex(i)}
                                                style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '4px 6px' }}
                                            />
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={coord[2]}
                                                onChange={(e) => updateComponentCoord(i, 2, Number.parseFloat(e.target.value))}
                                                onFocus={() => setSelectedComponentIndex(i)}
                                                style={{ background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', padding: '4px 6px' }}
                                            />
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
                    </div>
                )}
            </div>

            {addDialogOpen && (
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0,0,0,0.55)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 20
                }}>
                    <div style={{
                        width: '720px',
                        maxWidth: '92vw',
                        maxHeight: '85vh',
                        overflowY: 'auto',
                        background: '#1d1f22',
                        borderRadius: '12px',
                        padding: '18px',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
                        color: '#fff'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h3 style={{ margin: 0 }}>选择部件名称</h3>
                            <button
                                onClick={() => {
                                    setAddDialogOpen(false)
                                    setPendingPick(null)
                                    setSelectedLoop('')
                                    setSelectedPhase('')
                                    setSelectedPosition('')
                                    setSelectedComponentType('')
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#aaa',
                                    fontSize: '1.2rem',
                                    cursor: 'pointer'
                                }}
                            >×</button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                            <div>
                                <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '6px' }}>回路</div>
                                <select
                                    value={selectedLoop}
                                    onChange={(e) => setSelectedLoop(e.target.value)}
                                    disabled={isTowerSideSelection}
                                    style={{
                                        width: '100%',
                                        background: '#2b2f33',
                                        color: '#fff',
                                        border: '1px solid #444',
                                        borderRadius: '6px',
                                        padding: '8px'
                                    }}
                                >
                                    {LOOP_OPTIONS.map(option => (
                                        <option key={`loop-${option || 'none'}`} value={option}>
                                            {option || '回路'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '6px' }}>相位</div>
                                <select
                                    value={selectedPhase}
                                    onChange={(e) => setSelectedPhase(e.target.value)}
                                    disabled={isTowerSideSelection}
                                    style={{
                                        width: '100%',
                                        background: '#2b2f33',
                                        color: '#fff',
                                        border: '1px solid #444',
                                        borderRadius: '6px',
                                        padding: '8px'
                                    }}
                                >
                                    {PHASE_OPTIONS.map(option => (
                                        <option key={`phase-${option || 'none'}`} value={option}>
                                            {option || '相位'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '6px' }}>相对位置</div>
                                <select
                                    value={selectedPosition}
                                    onChange={(e) => {
                                        const value = e.target.value
                                        setSelectedPosition(value)
                                        if (value === TOWER_SMALL_NAME || value === TOWER_LARGE_NAME) {
                                            setSelectedLoop('')
                                            setSelectedPhase('')
                                            setSelectedComponentType('')
                                        }
                                    }}
                                    style={{
                                        width: '100%',
                                        background: '#2b2f33',
                                        color: '#fff',
                                        border: '1px solid #444',
                                        borderRadius: '6px',
                                        padding: '8px'
                                    }}
                                >
                                    {POSITION_OPTIONS.map(option => (
                                        <option key={`pos-${option || 'none'}`} value={option}>
                                            {option || '相对位置'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '6px' }}>部件类型</div>
                                <select
                                    value={selectedComponentType}
                                    onChange={(e) => setSelectedComponentType(e.target.value)}
                                    disabled={isTowerSideSelection}
                                    style={{
                                        width: '100%',
                                        background: '#2b2f33',
                                        color: '#fff',
                                        border: '1px solid #444',
                                        borderRadius: '6px',
                                        padding: '8px'
                                    }}
                                >
                                    {COMPONENT_TYPE_OPTIONS.map(option => (
                                        <option key={`type-${option || 'none'}`} value={option}>
                                            {option || '部件类型'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.8rem', color: '#bbb', marginBottom: '6px' }}>
                                部件名称（由属性拼接，小号侧/大号侧仅使用位置）
                            </div>
                            <input
                                type="text"
                                value={composedComponentName}
                                readOnly
                                placeholder="请选择部件属性"
                                style={{
                                    width: '100%',
                                    background: '#2b2f33',
                                    color: '#fff',
                                    border: '1px solid #444',
                                    borderRadius: '6px',
                                    padding: '8px'
                                }}
                            />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                onClick={() => {
                                    setAddDialogOpen(false)
                                    setPendingPick(null)
                                    setSelectedLoop('')
                                    setSelectedPhase('')
                                    setSelectedPosition('')
                                    setSelectedComponentType('')
                                }}
                                style={{
                                    background: '#3b3f44',
                                    border: 'none',
                                    color: '#ddd',
                                    padding: '8px 14px',
                                    borderRadius: '6px',
                                    cursor: 'pointer'
                                }}
                            >
                                取消
                            </button>
                            <button
                                onClick={handleConfirmAdd}
                                disabled={!composedComponentName}
                                style={{
                                    background: composedComponentName ? '#2ecc71' : '#3b3f44',
                                    border: 'none',
                                    color: composedComponentName ? '#fff' : '#888',
                                    padding: '8px 14px',
                                    borderRadius: '6px',
                                    cursor: composedComponentName ? 'pointer' : 'not-allowed',
                                    fontWeight: 600
                                }}
                            >
                                添加
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Help Tip */}
            <div style={{
                position: 'absolute',
                bottom: 20,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.6)',
                padding: '8px 16px',
                borderRadius: '20px',
                fontSize: '0.9rem',
                pointerEvents: 'none'
            }}>
                Left Click: Rotate • Right Click: Pan • Scroll: Zoom • <strong>Cmd + Click: Add</strong> • Double Click: Set Center
            </div>
        </div>
    )
}

export default App
