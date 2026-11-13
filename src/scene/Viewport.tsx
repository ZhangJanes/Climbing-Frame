import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls } from '@react-three/drei';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { PARTS, PART_MAP } from '../model/catalog';
import { poseOf, tubeLengthUnits } from '../model/layout';
import { JOINT_MM, MAX, nodePos } from '../model/metrics';
import { pickExisting, pickHover, type Hover } from '../model/pick';
import { deriveJoints, jointSignature, visiblePlacements } from '../model/joints';
import { tubeGuides } from '../model/guides';
import { boundsMm, occupiedCells } from '../model/rules';
import { assemblyLift, storyLevels } from '../model/layers';
import type { Placement } from '../model/types';
import { partGeometry, partMaterial } from './geometries';
import { useStore } from '../store';

const DRAW = PARTS.filter((part) => !['wheel', 'capsule', 'swing'].includes(part.feature ?? '')).map((part) => part.id);

const ORBIT_MOUSE = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

const dummy = new THREE.Object3D();
const basis = new THREE.Matrix4();
const tint = new THREE.Color('#ffffff');

type Shot = { px: number; py: number; pz: number; tx: number; ty: number; tz: number };
type Anim = { placement: Placement; from: number; kind: 'in' | 'out'; dur: number };

let aim: ((kind: 'iso' | 'top' | 'front' | 'side' | 'fit') => void) | null = null;
let rise: ((y: number) => void) | null = null;
let slideBy: ((x: number, y: number) => void) | null = null;
let requestCut: ((uid: string) => void) | null = null;

export type PartMenu = { x: number; y: number; uid: string };

export function look(kind: 'iso' | 'top' | 'front' | 'side' | 'fit') {
  aim?.(kind);
}

export function showLayer(y: number) {
  rise?.(y);
}

export function slide(x: number, y: number) {
  slideBy?.(x, y);
}

export function removePart(uid: string) {
  if (requestCut) {
    requestCut(uid);
    return;
  }
  const state = useStore.getState();
  if (uid.startsWith('auto:')) {
    state.showToast('拆掉管子，接头会跟着变');
    return;
  }
  state.remove(uid);
}

export function Viewport({
  onLabel,
  onMenu,
}: {
  onLabel: (text: string, bad: boolean, x: number, y: number, show: boolean) => void;
  onMenu: (menu: PartMenu | null) => void;
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      frameloop="demand"
      camera={{ position: [9.2, 6.4, 10.2], fov: 36, near: 0.08, far: 80 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = 1.15;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.setClearColor('#D7E6F1');
        scene.background = new THREE.Color('#D7E6F1');
      }}
    >
      <World onLabel={onLabel} onMenu={onMenu} />
    </Canvas>
  );
}

function World({
  onLabel,
  onMenu,
}: {
  onLabel: (text: string, bad: boolean, x: number, y: number, show: boolean) => void;
  onMenu: (menu: PartMenu | null) => void;
}) {
  const [ghost, setGhost] = useState<Hover | null>(null);
  const [anims, setAnims] = useState<Anim[]>([]);
  const hidden = anims.filter((item) => item.kind === 'in').map((item) => item.placement.uid);

  return (
    <>
      <Lights />
      <Room />
      <GuideLines />
      <Buckets hidden={hidden} />
      <Specials hidden={hidden} />
      <SelectionFrame />
      <SizeGuide />
      <HoverGhost hover={anims.length ? null : ghost} />
      {anims.map((item) => (
        <Arrive key={`${item.placement.uid}:${item.from}:${item.kind}`} anim={item} onDone={() => setAnims((list) => list.filter((entry) => entry !== item))} />
      ))}
      <Pointer onLabel={onLabel} onMenu={onMenu} setGhost={setGhost} setAnims={setAnims} />
      <Cutter setAnims={setAnims} />
      <Rig />
      <Pivot />
      <OrbitControls
        makeDefault
        enableDamping
        enablePan
        screenSpacePanning
        dampingFactor={0.12}
        rotateSpeed={0.7}
        zoomSpeed={0.65}
        panSpeed={0.8}
        minDistance={2.2}
        maxDistance={28}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
        mouseButtons={ORBIT_MOUSE}
      />
    </>
  );
}

function Lights() {
  const { gl, scene, invalidate } = useThree();
  const key = useRef<THREE.DirectionalLight>(null);
  useLayoutEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const light = key.current;
    if (light) {
      light.target.position.set(MAX.x / 2, 0.8, MAX.z / 2);
      scene.add(light.target);
    }
    invalidate();
    return () => {
      env.dispose();
      pmrem.dispose();
      if (light) scene.remove(light.target);
    };
  }, [gl, scene, invalidate]);

  return (
    <>
      <hemisphereLight args={['#F5FAFF', '#C5D5E4', 0.58]} />
      <directionalLight
        ref={key}
        position={[7.2, 12.5, 6.4]}
        intensity={2.35}
        color="#FFF6EE"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={2}
        shadow-camera-far={32}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.00035}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-6.5, 5.5, -3.5]} intensity={0.42} color="#E5F1FF" />
    </>
  );
}

function floorWash() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const pool = ctx.createRadialGradient(250, 230, 20, 256, 256, 340);
  pool.addColorStop(0, '#F7FBFE');
  pool.addColorStop(0.55, '#E7F1F8');
  pool.addColorStop(1, '#D7E6F1');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, 512, 512);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function Room() {
  const floorMap = useMemo(() => floorWash(), []);
  const lines = useMemo(() => {
    const position: number[] = [];
    for (let x = 0; x <= MAX.x; x += 1) position.push(x, 0.008, 0, x, 0.008, MAX.z);
    for (let z = 0; z <= MAX.z; z += 1) position.push(0, 0.008, z, MAX.x, 0.008, z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    return geo;
  }, []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[MAX.x / 2, 0, MAX.z / 2]} receiveShadow>
        <planeGeometry args={[48, 40]} />
        <meshStandardMaterial map={floorMap} color="#F3F8FC" roughness={0.94} metalness={0} envMapIntensity={0.12} />
      </mesh>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#6E9BB8" transparent opacity={0.72} />
      </lineSegments>
      <ContactShadows
        position={[MAX.x / 2, 0.012, MAX.z / 2]}
        opacity={0.42}
        width={MAX.x + 10}
        height={MAX.z + 10}
        scale={1}
        blur={2.4}
        far={8}
        color="#6E8DA6"
        resolution={512}
        frames={Infinity}
      />
    </group>
  );
}

function GuideLines() {
  const placements = useStore((state) => state.placements);
  const pitch = useStore((state) => state.pitch);
  const mode = useStore((state) => state.mode);
  const partId = useStore((state) => state.partId);
  const assemblyY = useStore((state) => state.assemblyY);
  const geo = useMemo(() => {
    const position: number[] = [];
    if (mode === 'place' && (partId === 'tube' || partId === 'rung')) {
      for (const guide of tubeGuides(placements)) {
        const a = nodePos(guide.x, guide.y, guide.z, pitch);
        const b = nodePos(
          guide.x + (guide.axis === 0 ? 1 : 0),
          guide.y + (guide.axis === 1 ? 1 : 0),
          guide.z + (guide.axis === 2 ? 1 : 0),
          pitch,
        );
        position.push(a[0], a[1] + 0.03, a[2], b[0], b[1] + 0.03, b[2]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    return geometry;
  }, [placements, pitch, mode, partId]);
  useEffect(() => () => geo.dispose(), [geo]);
  if (assemblyY !== null || !geo.getAttribute('position')?.count) return null;
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#F0C84A" transparent opacity={0.9} />
    </lineSegments>
  );
}

function Buckets({ hidden }: { hidden: string[] }) {
  const placements = useStore((state) => state.placements);
  const pitch = useStore((state) => state.pitch);
  const rungMm = useStore((state) => state.rungMm);
  const assemblyY = useStore((state) => state.assemblyY);
  const explode = useStore((state) => state.explodeLayers);
  const shown = useMemo(() => visiblePlacements(placements), [placements]);
  const levels = useMemo(() => storyLevels(placements), [placements]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const visible = shown.filter((item) => !hiddenSet.has(item.uid) && (assemblyY === null || item.y <= assemblyY));
  const current = assemblyY === null ? visible : visible.filter((item) => item.y === assemblyY);
  const past = assemblyY === null ? [] : visible.filter((item) => item.y < assemblyY);
  return (
    <>
      <BucketSet partItems={past} pitch={pitch} rungMm={rungMm} opacity={0.22} levels={levels} explode={explode} />
      <BucketSet partItems={current} pitch={pitch} rungMm={rungMm} opacity={1} levels={levels} explode={explode} />
    </>
  );
}

function BucketSet({
  partItems,
  pitch,
  rungMm,
  opacity,
  levels,
  explode,
}: {
  partItems: Placement[];
  pitch: number;
  rungMm: number;
  opacity: number;
  levels: number[];
  explode: boolean;
}) {
  return (
    <>
      {DRAW.map((partId) => (
        <Bucket
          key={partId}
          partId={partId}
          pitch={pitch}
          rungMm={rungMm}
          opacity={opacity}
          levels={levels}
          explode={explode}
          items={partItems.filter((item) => item.partId === partId)}
        />
      ))}
    </>
  );
}

function Bucket({
  partId,
  pitch,
  rungMm,
  items,
  opacity,
  levels,
  explode,
}: {
  partId: string;
  pitch: number;
  rungMm: number;
  items: Placement[];
  opacity: number;
  levels: number[];
  explode: boolean;
}) {
  const geo = useMemo(() => partGeometry(partId, pitch, rungMm), [partId, pitch, rungMm]);
  const mat = useMemo(() => {
    const material = partMaterial(partId);
    if (opacity < 1) {
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = false;
    }
    return material;
  }, [partId, opacity]);
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((item, index) => {
      writeDummy(item, pitch, rungMm, assemblyLift(item.y, levels, explode));
      mesh.setMatrixAt(index, dummy.matrix);
      tint.set(PART_MAP[item.partId]?.feature === 'tramp' ? '#ffffff' : item.color || '#141414');
      mesh.setColorAt(index, tint);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items, pitch, rungMm, levels, explode]);

  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);

  return <instancedMesh ref={ref} args={[geo, mat, 700]} castShadow={opacity === 1} receiveShadow={opacity === 1} frustumCulled={false} raycast={() => null} />;
}

function Specials({ hidden }: { hidden: string[] }) {
  const placements = useStore((state) => state.placements);
  const pitch = useStore((state) => state.pitch);
  const assemblyY = useStore((state) => state.assemblyY);
  const explode = useStore((state) => state.explodeLayers);
  const levels = useMemo(() => storyLevels(placements), [placements]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  return (
    <>
      {placements
        .filter((item) => ['wheel', 'capsule', 'swing'].includes(PARTS.find((part) => part.id === item.partId)?.feature ?? '') && !hiddenSet.has(item.uid))
        .filter((item) => assemblyY === null || item.y <= assemblyY)
        .map((item) => (
          <Special
            key={item.uid}
            placement={item}
            pitch={pitch}
            lift={assemblyLift(item.y, levels, explode && assemblyY !== null)}
            faded={assemblyY !== null && item.y < assemblyY}
          />
        ))}
    </>
  );
}

function Special({ placement, pitch, lift, faded }: { placement: Placement; pitch: number; lift: number; faded: boolean }) {
  const pose = poseOf(placement, pitch);
  const quaternion = useMemo(() => quatFrom(pose.matrix), [pose.matrix]);
  const feature = PARTS.find((part) => part.id === placement.partId)?.feature;
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !faded) return;
    const created: THREE.Material[] = [];
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.material || Array.isArray(mesh.material)) return;
      const material = mesh.material.clone();
      material.transparent = true;
      material.opacity = 0.22;
      material.depthWrite = false;
      mesh.material = material;
      created.push(material);
    });
    return () => created.forEach((material) => material.dispose());
  }, [faded, placement]);
  return (
    <group ref={ref} position={[pose.position[0], pose.position[1] + lift, pose.position[2]]} quaternion={quaternion}>
      {feature === 'wheel' ? <Wheel color={placement.color} /> : null}
      {feature === 'capsule' ? <Capsule color={placement.color} /> : null}
      {feature === 'swing' ? <Swing color={placement.color} /> : null}
    </group>
  );
}

function Wheel({ color }: { color: string }) {
  return (
    <group>
      <mesh castShadow rotation={[0, 0, 0]}>
        <torusGeometry args={[0.2, 0.02, 10, 28]} />
        <meshStandardMaterial color={color || '#F0C400'} roughness={0.35} />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh key={index} rotation={[0, 0, (index * Math.PI) / 3]} castShadow>
          <boxGeometry args={[0.34, 0.02, 0.02]} />
          <meshStandardMaterial color={color || '#F0C400'} roughness={0.35} />
        </mesh>
      ))}
      <mesh>
        <sphereGeometry args={[0.045, 16, 12]} />
        <meshStandardMaterial color="#17181A" roughness={0.4} />
      </mesh>
    </group>
  );
}

function Capsule({ color }: { color: string }) {
  return (
    <mesh castShadow>
      <sphereGeometry args={[0.32, 32, 20]} />
      <meshPhysicalMaterial color={color || '#d7ecff'} transmission={0.9} thickness={0.45} roughness={0.06} metalness={0} transparent />
    </mesh>
  );
}

function Swing({ color }: { color: string }) {
  return (
    <group>
      {[-0.28, 0.28].map((z) => (
        <mesh key={z} position={[0, 0.15, z]} castShadow>
          <cylinderGeometry args={[0.012, 0.012, 1.15, 8]} />
          <meshStandardMaterial color="#17181A" roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[0, -0.42, 0]} castShadow>
        <boxGeometry args={[0.34, 0.045, 0.62]} />
        <meshStandardMaterial color={color || '#D01212'} roughness={0.4} />
      </mesh>
    </group>
  );
}

function HoverGhost({ hover }: { hover: Hover | null }) {
  if (!hover) return null;
  return <PartGhost placement={{ ...hover.placement, uid: 'ghost' }} opacity={hover.ok ? 0.78 : 0.4} />;
}

function Arrive({ anim, onDone }: { anim: Anim; onDone: () => void }) {
  const reduce = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ended = useRef(false);
  const group = useRef<THREE.Group>(null);
  const { invalidate } = useThree();
  useFrame(() => {
    const node = group.current;
    if (!node) return;
    if (reduce.current) {
      if (!ended.current) {
        ended.current = true;
        onDone();
      }
      return;
    }
    const t = Math.min(1, (performance.now() - anim.from) / anim.dur);
    const e = easeOutStrong(t);
    const amount = anim.kind === 'in' ? 0.96 + 0.04 * e : 0.985 + 0.015 * (1 - e);
    const fade = anim.kind === 'in' ? e : 1 - e;
    node.scale.setScalar(amount);
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.material && 'opacity' in mesh.material) {
        mesh.material.opacity = fade;
        mesh.material.transparent = true;
      }
    });
    if (t < 1) invalidate();
    else if (!ended.current) {
      ended.current = true;
      onDone();
    }
  });
  return <PartGhost placement={anim.placement} opacity={anim.kind === 'in' ? 0 : 1} groupRef={group} />;
}

function PartGhost({ placement, opacity, groupRef }: { placement: Placement; opacity: number; groupRef?: RefObject<THREE.Group | null> }) {
  const pitch = useStore((state) => state.pitch);
  const rungMm = useStore((state) => state.rungMm);
  const local = useRef<THREE.Group>(null);
  const ref = groupRef ?? local;
  const partId = placement.partId;
  const geo = useMemo(() => (['wheel', 'capsule', 'swing'].includes(PARTS.find((part) => part.id === partId)?.feature ?? '') ? null : partGeometry(partId, pitch, rungMm)), [partId, pitch, rungMm]);
  const pose = poseOf(placement, pitch, rungMm);
  const quaternion = quatFrom(pose.matrix);
  const length = tubeLengthUnits(partId, pitch, rungMm);
  const feature = PARTS.find((part) => part.id === partId)?.feature;
  const color = placement.color || '#141414';
  return (
    <group ref={ref} position={pose.position} quaternion={quaternion}>
      <group scale={[1, length, 1]}>
        {geo ? (
          <mesh geometry={geo} castShadow>
            <meshPhysicalMaterial color={color} transparent opacity={opacity} roughness={0.18} clearcoat={1} clearcoatRoughness={0.08} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ) : null}
        {feature === 'wheel' ? <Wheel color={color} /> : null}
        {feature === 'capsule' ? <Capsule color={color} /> : null}
        {feature === 'swing' ? <Swing color={color} /> : null}
      </group>
    </group>
  );
}

function Pointer({
  onLabel,
  onMenu,
  setGhost,
  setAnims,
}: {
  onLabel: (text: string, bad: boolean, x: number, y: number, show: boolean) => void;
  onMenu: (menu: PartMenu | null) => void;
  setGhost: (hover: Hover | null) => void;
  setAnims: (anims: Anim[] | ((list: Anim[]) => Anim[])) => void;
}) {
  const { camera, gl, invalidate, controls } = useThree();
  const last = useRef('');
  const down = useRef<{ x: number; y: number; button: number } | null>(null);

  useEffect(() => {
    const dom = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const rayOf = (event: PointerEvent) => {
      const rect = dom.getBoundingClientRect();
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const { origin, direction } = raycaster.ray;
      return { ox: origin.x, oy: origin.y, oz: origin.z, dx: direction.x, dy: direction.y, dz: direction.z };
    };

    const hoverAt = (event: PointerEvent) => {
      const state = useStore.getState();
      const ray = rayOf(event);
      if (state.mode === 'place') {
        const part = PARTS.find((item) => item.id === state.partId);
        if (!part) return null;
        return pickHover({
          ray,
          part,
          placements: state.placements,
          stock: state.stock,
          pitch: state.pitch,
          ori: state.oriByPart[state.partId] ?? 0,
          color: part.category === 'joint' ? '' : state.color,
          rungMm: state.rungMm,
        });
      }
      const found = pickExisting(ray, visiblePlacements(state.placements), state.pitch, state.rungMm);
      if (!found) return null;
      return {
        placement: found,
        ok: true,
        reason: null,
        point: [0, 0, 0] as [number, number, number],
      };
    };

    const move = (event: PointerEvent) => {
      if (down.current && Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y) > 4) {
        dom.style.cursor = 'grabbing';
        invalidate();
        return;
      }
      const state = useStore.getState();
      const hover = hoverAt(event);
      const key = hover ? `${hover.placement.partId}:${hover.placement.x}:${hover.placement.y}:${hover.placement.z}:${hover.placement.ori}:${hover.ok}` : '';
      if (key !== last.current) {
        last.current = key;
        setGhost(state.mode === 'place' ? hover : null);
      }
      const partName = PARTS.find((item) => item.id === (hover?.placement.partId ?? state.partId))?.name ?? '';
      if (state.mode === 'place' && hover) onLabel(hover.reason ?? partName, !hover.ok, event.clientX, event.clientY, true);
      else if (hover && state.mode !== 'place') onLabel(partName, false, event.clientX, event.clientY, true);
      else onLabel('', false, 0, 0, false);
      dom.style.cursor = state.mode === 'look' ? 'grab' : hover && !hover.ok && state.mode === 'place' ? 'not-allowed' : 'crosshair';
      invalidate();
    };

    const lockPivot = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const orbit = controls as OrbitControlsImpl | null;
      if (!orbit) return;
      aimShot.current = null;
      focusStructure(camera, orbit);
      invalidate();
    };

    const downEvent = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 2) return;
      down.current = { x: event.clientX, y: event.clientY, button: event.button };
    };

    const up = (event: PointerEvent) => {
      if (!down.current || event.button !== down.current.button) return;
      const moved = Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y);
      const button = down.current.button;
      down.current = null;
      if (button === 2) {
        if (moved > 5) return;
        const state = useStore.getState();
        const found = pickExisting(rayOf(event), visiblePlacements(state.placements), state.pitch, state.rungMm);
        if (found) {
          state.select(found.uid, false);
          onMenu({ x: event.clientX, y: event.clientY, uid: found.uid });
        } else onMenu(null);
        invalidate();
        return;
      }
      if (moved > 5) return;
      const state = useStore.getState();
      const hover = hoverAt(event);
      if (state.mode === 'place' && state.assemblyY === null && hover?.ok) {
        const before = new Map(deriveJoints(state.placements).map((joint) => [joint.uid, jointSignature(joint)]));
        const id = state.place(hover.placement);
        const born = deriveJoints(useStore.getState().placements).filter((joint) => before.get(joint.uid) !== jointSignature(joint));
        const now = performance.now();
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduce) {
          const nowAnims: Anim[] = [
            { placement: { ...hover.placement, uid: id }, from: now, kind: 'in', dur: 200 },
            ...born.map((joint) => ({ placement: joint, from: now, kind: 'in' as const, dur: 200 })),
          ];
          setAnims((list) => [...list, ...nowAnims]);
        }
        invalidate();
      } else if (state.mode === 'delete' && hover && 'uid' in hover.placement) {
        forget((hover.placement as Placement).uid, setAnims);
        onMenu(null);
        invalidate();
      } else if (state.mode === 'paint' && hover && 'uid' in hover.placement) {
        const item = hover.placement as Placement;
        if (PARTS.find((part) => part.id === item.partId)?.category === 'joint') state.showToast('接头保持黑色');
        else state.paint(item.uid);
        invalidate();
      } else if (state.mode === 'look' && hover && 'uid' in hover.placement) {
        state.select((hover.placement as Placement).uid);
      }
    };

    const leave = () => {
      last.current = '';
      setGhost(null);
      onLabel('', false, 0, 0, false);
    };

    const blockMenu = (event: Event) => event.preventDefault();
    dom.addEventListener('pointerdown', lockPivot, true);
    dom.addEventListener('pointermove', move);
    dom.addEventListener('pointerdown', downEvent);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointerleave', leave);
    dom.addEventListener('contextmenu', blockMenu);
    const orbit = controls as OrbitControlsImpl | null;
    const cancel = () => {
      aimShot.current = null;
    };
    orbit?.addEventListener('start', cancel);
    return () => {
      dom.removeEventListener('pointerdown', lockPivot, true);
      dom.removeEventListener('pointermove', move);
      dom.removeEventListener('pointerdown', downEvent);
      dom.removeEventListener('pointerup', up);
      dom.removeEventListener('pointerleave', leave);
      dom.removeEventListener('contextmenu', blockMenu);
      orbit?.removeEventListener('start', cancel);
    };
  }, [camera, gl, invalidate, controls, onLabel, onMenu, setGhost, setAnims]);

  return null;
}

const aimShot = { current: null as { shot: Shot; vel: number[] } | null };

function Rig() {
  const { camera, controls, invalidate } = useThree();
  useEffect(() => {
    aim = (kind) => {
      const state = useStore.getState();
      const shot = shotFor(kind, state.placements, state.pitch, camera, controls as OrbitControlsImpl | null);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const orbit = controls as OrbitControlsImpl | null;
      if (!orbit) return;
      if (reduce) {
        camera.position.set(shot.px, shot.py, shot.pz);
        orbit.target.set(shot.tx, shot.ty, shot.tz);
        orbit.update();
        invalidate();
        return;
      }
      aimShot.current = { shot, vel: [0, 0, 0, 0, 0, 0] };
      invalidate();
    };
    rise = (y) => {
      const orbit = controls as OrbitControlsImpl | null;
      if (!orbit) return;
      const pitch = useStore.getState().pitch;
      const height = nodePos(0, y, 0, pitch)[1];
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const shot = {
        px: camera.position.x,
        py: Math.max(camera.position.y, height + 1.8),
        pz: camera.position.z,
        tx: orbit.target.x,
        ty: height + 0.35,
        tz: orbit.target.z,
      };
      if (reduce) {
        camera.position.set(shot.px, shot.py, shot.pz);
        orbit.target.set(shot.tx, shot.ty, shot.tz);
        orbit.update();
        invalidate();
        return;
      }
      aimShot.current = { shot, vel: [0, 0, 0, 0, 0, 0] };
      invalidate();
    };
    return () => {
      aim = null;
      rise = null;
    };
  }, [camera, controls, invalidate]);

  useFrame((_, delta) => {
    const job = aimShot.current;
    const orbit = controls as OrbitControlsImpl | null;
    if (!job || !orbit) return;
    const dt = Math.min(0.032, delta);
    const values = [camera.position.x, camera.position.y, camera.position.z, orbit.target.x, orbit.target.y, orbit.target.z];
    const goal = [job.shot.px, job.shot.py, job.shot.pz, job.shot.tx, job.shot.ty, job.shot.tz];
    let done = true;
    for (let i = 0; i < 6; i += 1) {
      const acc = (goal[i] - values[i]) * 70 - job.vel[i] * 16;
      job.vel[i] += acc * dt;
      values[i] += job.vel[i] * dt;
      if (Math.abs(goal[i] - values[i]) > 0.01 || Math.abs(job.vel[i]) > 0.02) done = false;
    }
    camera.position.set(values[0], values[1], values[2]);
    orbit.target.set(values[3], values[4], values[5]);
    orbit.update();
    if (done) aimShot.current = null;
    else invalidate();
  });

  return null;
}

function structureCenter(placements: Placement[], pitch: number) {
  const cells = occupiedCells(placements);
  if (!cells) return new THREE.Vector3(4.5, 0.8, 3.6);
  const min = nodePos(cells.minX, cells.minY, cells.minZ, pitch);
  const max = nodePos(cells.maxX, cells.maxY, cells.maxZ, pitch);
  return new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
}

function focusStructure(camera: THREE.Camera, orbit: OrbitControlsImpl) {
  const state = useStore.getState();
  const center = structureCenter(state.placements, state.pitch);
  const delta = center.clone().sub(orbit.target);
  if (delta.lengthSq() < 1e-8) return;
  orbit.target.copy(center);
  camera.position.add(delta);
  orbit.update();
}

function Pivot() {
  const { camera, controls, invalidate } = useThree();
  const placements = useStore((state) => state.placements);
  const pitch = useStore((state) => state.pitch);
  const seen = useRef('');
  useLayoutEffect(() => {
    const orbit = controls as OrbitControlsImpl | null;
    if (!orbit) return;
    const center = structureCenter(placements, pitch);
    const key = `${center.x.toFixed(3)}:${center.y.toFixed(3)}:${center.z.toFixed(3)}`;
    if (seen.current === key) return;
    if (!seen.current) orbit.target.copy(center);
    else {
      const [px, py, pz] = seen.current.split(':').map(Number);
      const delta = new THREE.Vector3(center.x - px, center.y - py, center.z - pz);
      orbit.target.add(delta);
      camera.position.add(delta);
    }
    seen.current = key;
    orbit.update();
    invalidate();
  }, [placements, pitch, camera, controls, invalidate]);

  useEffect(() => {
    slideBy = (x, y) => {
      const orbit = controls as OrbitControlsImpl | null;
      if (!orbit) return;
      aimShot.current = null;
      camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      const dist = camera.position.distanceTo(orbit.target);
      const step = Math.max(0.4, dist * 0.14);
      const move = right.multiplyScalar(x * step).add(up.multiplyScalar(y * step));
      camera.position.add(move);
      orbit.target.add(move);
      orbit.update();
      invalidate();
    };
    return () => {
      slideBy = null;
    };
  }, [camera, controls, invalidate]);

  return null;
}

function shotFor(kind: 'iso' | 'top' | 'front' | 'side' | 'fit', placements: Placement[], pitch: number, camera: THREE.Camera, orbit: OrbitControlsImpl | null): Shot {
  const size = boundsMm(placements, pitch);
  const center = structureCenter(placements, pitch);
  const span = size ? Math.max(size.w, size.d, size.h) / pitch : 4;
  const dist = Math.max(4.5, span * 1.7);
  const target = { tx: center.x, ty: center.y, tz: center.z };
  if (kind === 'top') return { ...target, px: center.x, py: center.y + dist, pz: center.z + 0.01 };
  if (kind === 'front') return { ...target, px: center.x, py: center.y + dist * 0.35, pz: center.z + dist };
  if (kind === 'side') return { ...target, px: center.x + dist, py: center.y + dist * 0.28, pz: center.z };
  if (kind === 'fit' && orbit) {
    const dir = camera.position.clone().sub(orbit.target);
    if (dir.lengthSq() < 0.001) dir.set(1, 0.7, 1);
    dir.normalize().multiplyScalar(dist);
    return { ...target, px: center.x + dir.x, py: center.y + dir.y, pz: center.z + dir.z };
  }
  return { ...target, px: center.x + dist * 0.85, py: center.y + dist * 0.62, pz: center.z + dist * 0.9 };
}

function Cutter({ setAnims }: { setAnims: (anims: Anim[] | ((list: Anim[]) => Anim[])) => void }) {
  const { invalidate } = useThree();
  useEffect(() => {
    requestCut = (uid) => {
      forget(uid, setAnims);
      invalidate();
    };
    return () => {
      requestCut = null;
    };
  }, [invalidate, setAnims]);
  return null;
}

function forget(uid: string, setAnims: (anims: Anim[] | ((list: Anim[]) => Anim[])) => void) {
  const state = useStore.getState();
  if (uid.startsWith('auto:')) {
    state.showToast('拆掉管子，接头会跟着变');
    return;
  }
  const item = state.placements.find((entry) => entry.uid === uid);
  if (!item) return;
  const before = deriveJoints(state.placements);
  state.remove(item.uid);
  const afterList = deriveJoints(useStore.getState().placements);
  const after = new Map(afterList.map((joint) => [joint.uid, jointSignature(joint)]));
  const removed = before.filter((joint) => !after.has(joint.uid));
  const changed = afterList.filter((joint) => {
    const previous = before.find((entry) => entry.uid === joint.uid);
    return previous ? jointSignature(previous) !== jointSignature(joint) : false;
  });
  const now = performance.now();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) {
    const nowAnims: Anim[] = [
      { placement: item, from: now, kind: 'out', dur: 180 },
      ...removed.map((joint) => ({ placement: joint, from: now, kind: 'out' as const, dur: 160 })),
      ...changed.map((joint) => ({ placement: joint, from: now, kind: 'in' as const, dur: 200 })),
    ];
    setAnims((list) => [...list, ...nowAnims]);
  }
}

function SelectionFrame() {
  const uid = useStore((state) => state.selectedUid);
  const placements = useStore((state) => state.placements);
  const pitch = useStore((state) => state.pitch);
  const rungMm = useStore((state) => state.rungMm);
  const placement = useMemo(() => {
    if (!uid) return null;
    return placements.find((item) => item.uid === uid) ?? deriveJoints(placements).find((item) => item.uid === uid) ?? null;
  }, [uid, placements]);
  const explode = useStore((state) => state.explodeLayers);
  const assemblyY = useStore((state) => state.assemblyY);
  const levels = useMemo(() => storyLevels(placements), [placements]);
  const lift = !placement || assemblyY === null ? 0 : assemblyLift(placement.y, levels, explode);
  const frame = useMemo(() => (placement ? selectionFrame(placement, pitch, rungMm, lift) : null), [placement, pitch, rungMm, lift]);
  const lines = useRef<THREE.LineSegments>(null);
  useLayoutEffect(() => {
    lines.current?.computeLineDistances();
  }, [frame]);
  useEffect(() => () => frame?.edges.dispose(), [frame]);
  if (!frame) return null;
  return (
    <lineSegments ref={lines} position={frame.center} geometry={frame.edges} renderOrder={3}>
      <lineDashedMaterial color="#1A47FF" dashSize={0.07} gapSize={0.045} toneMapped={false} depthTest={false} />
    </lineSegments>
  );
}

function selectionFrame(placement: Placement, pitch: number, rungMm: number, lift: number) {
  const box = worldBox(placement, pitch, rungMm, lift);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const solid = new THREE.BoxGeometry(Math.max(size.x, 0.08), Math.max(size.y, 0.08), Math.max(size.z, 0.08));
  const edges = new THREE.EdgesGeometry(solid);
  solid.dispose();
  return { center, edges };
}

function worldBox(placement: Placement, pitch: number, rungMm: number, lift = 0) {
  const local = localBounds(placement.partId, pitch, rungMm);
  const pose = poseOf(placement, pitch, rungMm);
  const rotation = quatFrom(pose.matrix);
  const stretch = placement.partId === 'tube' || placement.partId === 'rung' ? tubeLengthUnits(placement.partId, pitch, rungMm) : 1;
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const x of [local.min.x, local.max.x]) {
    for (const y of [local.min.y, local.max.y]) {
      for (const z of [local.min.z, local.max.z]) {
        point.set(x, y * stretch, z).applyQuaternion(rotation);
        point.x += pose.position[0];
        point.y += pose.position[1] + lift;
        point.z += pose.position[2];
        box.expandByPoint(point);
      }
    }
  }
  box.expandByScalar(0.045);
  return box;
}

function localBounds(partId: string, pitch: number, rungMm: number) {
  const feature = PART_MAP[partId]?.feature;
  const box = new THREE.Box3();
  if (feature === 'wheel') return box.set(new THREE.Vector3(-0.24, -0.24, -0.05), new THREE.Vector3(0.24, 0.24, 0.05));
  if (feature === 'capsule') return box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.68, 0.68, 0.68));
  if (feature === 'swing') return box.set(new THREE.Vector3(-0.22, -0.52, -0.36), new THREE.Vector3(0.22, 0.78, 0.36));
  const geo = partGeometry(partId, pitch, rungMm);
  geo.computeBoundingBox();
  box.copy(geo.boundingBox ?? new THREE.Box3(new THREE.Vector3(-0.2, -0.2, -0.2), new THREE.Vector3(0.2, 0.2, 0.2)));
  geo.dispose();
  return box;
}

function SizeGuide() {
  const show = useStore((state) => state.showSize);
  const placements = useStore((state) => state.placements);
  const pitch = useStore((state) => state.pitch);
  const guide = useMemo(() => sizeMarks(placements, pitch), [placements, pitch]);
  if (!show || !guide) return null;
  return (
    <group>
      <DimLine a={guide.length[0]} b={guide.length[1]} label={`长 ${cmLabel(guide.w)} cm`} />
      <DimLine a={guide.width[0]} b={guide.width[1]} label={`宽 ${cmLabel(guide.d)} cm`} />
      <DimLine a={guide.height[0]} b={guide.height[1]} label={`高 ${cmLabel(guide.h)} cm`} />
    </group>
  );
}

function sizeMarks(placements: Placement[], pitch: number) {
  const cells = occupiedCells(placements);
  const size = boundsMm(placements, pitch);
  if (!cells || !size) return null;
  const pad = JOINT_MM / pitch / 2;
  const min = nodePos(cells.minX, cells.minY, cells.minZ, pitch);
  const max = nodePos(cells.maxX, cells.maxY, cells.maxZ, pitch);
  const x0 = min[0] - pad;
  const y0 = min[1] - pad;
  const z0 = min[2] - pad;
  const x1 = max[0] + pad;
  const y1 = max[1] + pad;
  const z1 = max[2] + pad;
  const gap = 0.32;
  return {
    w: size.w,
    d: size.d,
    h: size.h,
    length: [[x0, y0, z0 - gap], [x1, y0, z0 - gap]] as [[number, number, number], [number, number, number]],
    width: [[x1 + gap, y0, z0], [x1 + gap, y0, z1]] as [[number, number, number], [number, number, number]],
    height: [[x0 - gap, y0, z0 - gap], [x0 - gap, y1, z0 - gap]] as [[number, number, number], [number, number, number]],
  };
}

function DimLine({ a, b, label }: { a: [number, number, number]; b: [number, number, number]; label: string }) {
  const geo = useMemo(() => dimensionGeometry(a, b), [a, b]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.14, (a[2] + b[2]) / 2];
  return (
    <group>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color="#17181A" />
      </lineSegments>
      <Html position={mid} center sprite zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
        <div className="dim-tag">{label}</div>
      </Html>
    </group>
  );
}

function dimensionGeometry(a: [number, number, number], b: [number, number, number]) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const dir = end.clone().sub(start);
  const side = new THREE.Vector3();
  if (Math.abs(dir.y) > Math.abs(dir.x) && Math.abs(dir.y) > Math.abs(dir.z)) side.set(1, 0, 0);
  else side.crossVectors(dir, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
  side.normalize().multiplyScalar(0.07);
  const positions = [
    ...a, ...b,
    a[0] - side.x, a[1] - side.y, a[2] - side.z, a[0] + side.x, a[1] + side.y, a[2] + side.z,
    b[0] - side.x, b[1] - side.y, b[2] - side.z, b[0] + side.x, b[1] + side.y, b[2] + side.z,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function cmLabel(mm: number) {
  return (mm / 10).toFixed(mm % 10 === 0 ? 0 : 1);
}

function writeDummy(item: Placement, pitch: number, rungMm: number, lift = 0) {
  const pose = poseOf(item, pitch, rungMm);
  dummy.position.set(pose.position[0], pose.position[1] + lift, pose.position[2]);
  dummy.quaternion.copy(quatFrom(pose.matrix));
  const stretch = item.partId === 'tube' || item.partId === 'rung' ? tubeLengthUnits(item.partId, pitch, rungMm) : 1;
  dummy.scale.set(1, stretch, 1);
  dummy.updateMatrix();
}

function quatFrom(matrix: number[]) {
  basis.set(matrix[0], matrix[1], matrix[2], 0, matrix[3], matrix[4], matrix[5], 0, matrix[6], matrix[7], matrix[8], 0, 0, 0, 0, 1);
  const q = new THREE.Quaternion();
  q.setFromRotationMatrix(basis);
  return q;
}

function easeOutStrong(t: number) {
  let u = t;
  for (let i = 0; i < 5; i += 1) {
    const x = bez(u, 0.23, 0.32) - t;
    const dx = dbez(u, 0.23, 0.32);
    if (Math.abs(dx) < 1e-4) break;
    u = Math.min(1, Math.max(0, u - x / dx));
  }
  return bez(u, 1, 1);
}

function bez(t: number, p1: number, p2: number) {
  const c = 3 * p1;
  const d = 3 * (p2 - p1) - c;
  const e = 1 - c - d;
  return ((e * t + d) * t + c) * t;
}

function dbez(t: number, p1: number, p2: number) {
  const c = 3 * p1;
  const d = 3 * (p2 - p1) - c;
  const e = 1 - c - d;
  return (3 * e * t + 2 * d) * t + c;
}
