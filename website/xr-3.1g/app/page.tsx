'use client'

import { useState } from 'react'
import XR3DOrb from '../components/XR3DOrb'
import { ArrowRight, Download, Github } from 'lucide-react'

export default function XRWebsite() {
  const [showInstall, setShowInstall] = useState(false)

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F8FAFC] overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0A0A0C]/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="XR" className="h-9 w-auto" />
            <span className="font-semibold tracking-[-0.02em] text-2xl">XR</span>
          </div>
          
          <div className="hidden md:flex items-center gap-10 text-sm font-medium">
            <a href="#architecture" className="hover:text-[#3B82F6] transition-colors">Architecture</a>
            <a href="#capabilities" className="hover:text-[#3B82F6] transition-colors">Capabilities</a>
            <a href="#install" className="hover:text-[#3B82F6] transition-colors">Install</a>
            <a href="https://github.com/ahmadrrrtx/xr" target="_blank" className="hover:text-[#3B82F6] transition-colors flex items-center gap-2">
              <Github className="w-4 h-4" /> GitHub
            </a>
          </div>

          <button 
            onClick={() => {
              const el = document.getElementById('install')
              el?.scrollIntoView({ behavior: 'smooth' })
            }}
            className="xr-button px-6 py-2.5 bg-white text-black rounded-full text-sm font-semibold flex items-center gap-2 hover:bg-[#3B82F6] hover:text-white transition-all"
          >
            Install XR <Download className="w-4 h-4" />
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-20 pb-12 relative">
        <div className="max-w-6xl mx-auto px-8 pt-16 text-center">
          <div className="inline-flex items-center px-4 py-1 rounded-full border border-white/10 text-sm mb-6 tracking-[0.5px]">
            XR 3.1G — The AI Operating System
          </div>
          
          <h1 className="text-[72px] md:text-[92px] leading-[0.92] font-semibold tracking-[-4.8px] mb-6">
            One brain.<br />Infinite capabilities.
          </h1>
          
          <p className="max-w-[620px] mx-auto text-2xl text-[#64748B] tracking-[-0.3px] mb-12">
            The future of personal computing.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button 
              onClick={() => {
                const el = document.getElementById('install')
                el?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="xr-button group px-9 py-4 bg-[#3B82F6] hover:bg-[#2563EB] rounded-2xl text-xl font-semibold flex items-center justify-center gap-3 transition-all"
            >
              Install XR <ArrowRight className="group-hover:translate-x-0.5 transition" />
            </button>
            <a 
              href="https://github.com/ahmadrrrtx/xr" 
              target="_blank"
              className="xr-button px-9 py-4 border border-white/20 hover:bg-white/5 rounded-2xl text-xl font-semibold flex items-center justify-center gap-3 transition-all"
            >
              View on GitHub
            </a>
          </div>
        </div>

        {/* 3D ORB — Hero */}
        <div className="mt-8 -mb-12 relative z-10">
          <XR3DOrb />
        </div>
      </section>

      {/* WHY XR EXISTS */}
      <section className="section max-w-5xl mx-auto px-8 text-center border-t border-white/10">
        <div className="max-w-2xl mx-auto">
          <div className="text-[#3B82F6] text-sm tracking-[2px] mb-3">THE PROBLEM</div>
          <h2 className="text-6xl font-semibold tracking-[-2.4px] mb-8">
            Software was never meant to be this fragmented.
          </h2>
          <p className="text-2xl text-[#64748B]">
            Dozens of tools. Multiple AIs. No memory. No unity.
          </p>
        </div>
      </section>

      {/* ONE BRAIN */}
      <section id="architecture" className="section max-w-5xl mx-auto px-8">
        <div className="text-center mb-16">
          <div className="text-[#3B82F6] text-sm tracking-[2px] mb-3">THE SOLUTION</div>
          <h2 className="text-7xl font-semibold tracking-[-3.2px]">One Brain.<br />Infinite Interfaces.</h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            { title: "Local & Cloud", desc: "Run powerful models locally or connect to any cloud provider." },
            { title: "Computer Control", desc: "XR can see, click, type, and control your entire machine." },
            { title: "Persistent Memory", desc: "Remembers everything across sessions, projects, and time." },
          ].map((item, index) => (
            <div key={index} className="interactive-card border border-white/10 bg-white/[0.015] p-9 rounded-3xl">
              <div className="text-4xl font-semibold tracking-tight mb-4">{item.title}</div>
              <p className="text-[#64748B] text-lg">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CAPABILITY EXPLORER */}
      <section id="capabilities" className="section bg-black/40 border-y border-white/10">
        <div className="max-w-6xl mx-auto px-8">
          <div className="text-center mb-16">
            <div className="text-[#3B82F6] text-sm tracking-[2px] mb-3">EVERYTHING XR CAN DO</div>
            <h3 className="text-6xl font-semibold tracking-[-2px]">A complete AI Operating System</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              "Chat", "Code", "Research", "Browse", "Voice", "Computer Control", "Install Software", 
              "Fix Problems", "Memory", "Shield", "Plugins", "Skills Marketplace", "MCP", "Multi-Agent", 
              "Workflows", "Business OS", "Local AI", "Cloud AI", "Offline Mode", "API Integration"
            ].map((cap, i) => (
              <div key={i} className="interactive-card px-6 py-5 border border-white/10 hover:border-[#3B82F6]/40 rounded-2xl text-center text-lg font-medium tracking-tight transition-all">
                {cap}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* INSTALL SECTION */}
      <section id="install" className="section max-w-4xl mx-auto px-8 text-center">
        <div className="mb-10">
          <div className="text-[#3B82F6] text-sm tracking-[2px] mb-3">GET STARTED IN SECONDS</div>
          <h2 className="text-7xl font-semibold tracking-[-3px]">Install XR</h2>
        </div>

        <div className="bg-[#111113] border border-white/10 rounded-3xl p-10 text-left max-w-2xl mx-auto">
          <div className="font-mono text-sm text-[#3B82F6] mb-4">TERMINAL</div>
          
          <div className="bg-black rounded-2xl p-6 font-mono text-lg border border-white/10">
            npm install -g xr-cli<br />
            xr init
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 text-sm">
            <div className="bg-white/5 p-4 rounded-2xl">Windows • macOS • Linux</div>
            <div className="bg-white/5 p-4 rounded-2xl">Docker • Bun • npm</div>
          </div>
        </div>

        <p className="mt-8 text-[#64748B]">Supports local models, cloud providers, and fully offline operation.</p>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/10 py-16 px-8 text-center text-sm text-[#64748B]">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-y-4">
          <div>XR — The AI Operating System</div>
          <div>© {new Date().getFullYear()} XR Contributors</div>
          <div className="flex gap-6">
            <a href="https://github.com/ahmadrrrtx/xr" className="hover:text-white">GitHub</a>
            <a href="#architecture" className="hover:text-white">Docs</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
