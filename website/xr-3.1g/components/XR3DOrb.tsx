'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'

function CoreOrb() {
  const groupRef = useRef<THREE.Group>(null!)
  const coreRef = useRef<THREE.Mesh>(null!)
  const ringRef = useRef<THREE.Group>(null!)

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.15
    }
    if (coreRef.current) {
      coreRef.current.rotation.y = state.clock.elapsedTime * 0.4
    }
    if (ringRef.current) {
      ringRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.3
      ringRef.current.rotation.z = state.clock.elapsedTime * 0.2
    }
  })

  return (
    <group ref={groupRef}>
      <mesh ref={coreRef}>
        <sphereGeometry args={[1.8]} />
        <meshPhongMaterial 
          color="#3B82F6" 
          emissive="#1E40AF" 
          shininess={100}
          specular="#ffffff"
        />
      </mesh>

      <mesh>
        <sphereGeometry args={[2.1]} />
        <meshBasicMaterial 
          color="#3B82F6" 
          transparent 
          opacity={0.15} 
        />
      </mesh>

      <group ref={ringRef}>
        <mesh>
          <torusGeometry args={[3.2, 0.04, 16, 100]} />
          <meshPhongMaterial color="#64748B" />
        </mesh>
      </group>

      {[0, 1, 2, 3].map((i) => (
        <mesh 
          key={i} 
          position={[
            Math.cos((i * Math.PI) / 2) * 3.8, 
            Math.sin((i * Math.PI) / 2) * 0.8, 
            Math.sin((i * Math.PI) / 2) * 3.8
          ]}
        >
          <sphereGeometry args={[0.12]} />
          <meshPhongMaterial color="#F8FAFC" emissive="#3B82F6" />
        </mesh>
      ))}
    </group>
  )
}

export default function XR3DOrb() {
  return (
    <div className="canvas-container w-full h-[520px] md:h-[620px]">
      <Canvas
        camera={{ position: [0, 0, 12], fov: 45 }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1.2} color="#ffffff" />
        <pointLight position={[-10, -10, -5]} intensity={0.6} color="#3B82F6" />
        
        <CoreOrb />
        
        <OrbitControls 
          enableZoom={false} 
          enablePan={false} 
          autoRotate 
          autoRotateSpeed={0.3}
          enableDamping 
          dampingFactor={0.05}
        />
      </Canvas>
    </div>
  )
}
