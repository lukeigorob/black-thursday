// The sky (world.gd buildSky): Three's Sky (three/addons/objects/Sky.js, r186: Preetham's daylight model with its
// faint cirrus) by day, the dark gradient and its stars by night, the overcast's grey lid over either. The JS drew it
// once into a cube map (the background, at backgroundIntensity) and a PMREM'd one (the light and reflections, at
// environmentIntensity, with a hemisphere light on top); here it's one sky shader: the background pass dims it as
// backgroundIntensity did, the radiance pass (Godot's ambient and reflections) scales it by environmentIntensity and
// carries the hemisphere light's sky / ground colours. The sun's and moon's sprites are drawn in it too (background
// only, as the sprites never were in the light's cube), at the brightness the sprites had.
shader_type sky;

uniform bool night = false;
uniform float turbidity = 2.0;
uniform float rayleigh = 1.0;
uniform float mie_coefficient = 0.005;
uniform float mie_directional_g = 0.8;
uniform vec3 sun_position = vec3(0.0, 1.0, 0.0); // (towards the sun, unit: the track's sun, the turn is sky_rotation)
uniform float cloud_coverage = 0.25; // faint high cirrus
uniform float overcast = 0.0; // the lid: its opacity is min(0.95, o * 0.95)
uniform vec3 lid_color = vec3(0.62, 0.65, 0.7);
uniform float bg_intensity = 0.55; // backgroundIntensity
uniform float env_intensity = 0.6; // environmentIntensity
uniform vec3 hemi_sky = vec3(0.0);
uniform vec3 hemi_ground = vec3(0.0);
uniform float hemi_intensity = 0.0;
uniform sampler2D stars : filter_linear, repeat_enable;
// the sun's sprite: its colour (L.sun times its brightness), shown or not
uniform vec3 sun_sprite = vec3(0.0);
uniform vec3 moon_tint = vec3(1.15, 1.15, 1.2);
uniform vec3 moon_glow_tint = vec3(1.1, 1.15, 1.35);
uniform bool moon_on = false;
uniform sampler2D moon_tex : source_color, filter_linear_mipmap;
uniform sampler2D moon_glow_tex : source_color, filter_linear;

const float e = 2.71828182845904523536028747135266249775724709369995957;
const float pi = 3.141592653589793238462643383279502884197169;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;

float sunIntensity(float zenithAngleCos) {
	zenithAngleCos = clamp(zenithAngleCos, -1.0, 1.0);
	return EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(zenithAngleCos)) / steepness)));
}
vec3 totalMie(float T) {
	float c = (0.2 * T) * 10E-18;
	return 0.434 * c * MieConst;
}
vec2 gradient(vec2 i) {
	vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yzx + 33.33);
	return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
}
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	float a = dot(gradient(i), f);
	float b = dot(gradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
	float c = dot(gradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
	float d = dot(gradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}
float fbm(vec2 p, float drift) {
	float result = 0.0;
	float amplitude = 1.0;
	for (int i = 0; i < 4; i++) {
		result += amplitude * noise(p);
		amplitude *= 0.5;
		p = p * 2.0 + drift;
	}
	return result;
}
float rayleighPhase(float cosTheta) { return THREE_OVER_SIXTEENPI * (1.0 + pow(cosTheta, 2.0)); }
float hgPhase(float cosTheta, float g) {
	float g2 = pow(g, 2.0);
	float inverse = 1.0 / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5);
	return ONE_OVER_FOURPI * ((1.0 - g2) * inverse);
}

// Three's SkyShader, the vertex and fragment stages together (time 0, no sun disc: the sprite is the sun)
vec3 day_sky(vec3 direction) {
	vec3 vSunDirection = normalize(sun_position);
	float vSunE = sunIntensity(vSunDirection.y);
	float vSunfade = 1.0 - clamp(1.0 - exp((sun_position.y / 450000.0)), 0.0, 1.0);
	float rayleighCoefficient = rayleigh - (1.0 * (1.0 - vSunfade));
	vec3 vBetaR = totalRayleigh * rayleighCoefficient;
	vec3 vBetaM = totalMie(turbidity) * mie_coefficient;

	float zenithAngle = acos(max(0.0, direction.y));
	float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
	float sR = rayleighZenithLength * inverse;
	float sM = mieZenithLength * inverse;
	vec3 Fex = exp(-(vBetaR * sR + vBetaM * sM));
	float cosTheta = dot(direction, vSunDirection);
	float rPhase = rayleighPhase(cosTheta * 0.5 + 0.5);
	vec3 betaRTheta = vBetaR * rPhase;
	float mPhase = hgPhase(cosTheta, mie_directional_g);
	vec3 betaMTheta = vBetaM * mPhase;
	vec3 Lin = pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
	Lin *= mix(vec3(1.0), pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * Fex, vec3(1.0 / 2.0)), clamp(pow(1.0 - vSunDirection.y, 5.0), 0.0, 1.0));
	vec3 L0 = vec3(0.1) * Fex;
	vec3 texColor = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);

	if (direction.y > 0.0 && cloud_coverage > 0.0) {
		const float cloudScale = 0.0002;
		const float cloudDensity = 0.4;
		const float cloudElevation = 0.5;
		float elevation = mix(1.0, 0.1, cloudElevation);
		vec2 cloudUV = direction.xz / (direction.y * elevation);
		cloudUV *= cloudScale;
		float cloudNoise = clamp(fbm(cloudUV * 1000.0, 0.0) * 0.7 + 0.5, 0.0, 1.0);
		float region = noise(cloudUV * 300.0) * 0.37 + 0.5;
		float cov = clamp(cloud_coverage + (region - 0.5) * 0.6, 0.0, 1.0);
		float threshold = 1.0 - cov;
		float cloudMask = smoothstep(threshold, threshold + 0.3, cloudNoise);
		float horizonFade = smoothstep(0.0, 0.03 + 0.06 * cloudElevation, direction.y);
		cloudMask *= horizonFade;
		float dayFactor = smoothstep(-0.08, 0.3, vSunDirection.y);
		vec3 sunColor = vSunE * Fex * 0.22 * 0.04;
		vec3 skyAmbient = Lin * 0.04 + vec3(0.0, 0.0003, 0.00075);
		float depth = max(0.0, cloudNoise - threshold);
		float beer = exp(depth * -4.0);
		float powder = 1.0 - beer * beer;
		float shade = mix(0.45, 1.0, clamp(beer * powder * 2.6, 0.0, 1.0));
		float silver = clamp(0.51 / pow(1.49 - cosTheta * 1.4, 1.5), 0.0, 3.0);
		float edge = cloudMask * (1.0 - cloudMask) * 4.0;
		vec3 cloudColor = skyAmbient + sunColor * shade;
		cloudColor += sunColor * silver * edge * 0.6;
		cloudColor *= max(dayFactor, 0.03);
		float alpha = (1.0 - exp(depth * cloudDensity * -12.0)) * horizonFade;
		texColor -= L0 * 0.04 * alpha;
		vec3 cloudAerial = mix(texColor, cloudColor, Fex);
		texColor = mix(texColor, cloudAerial, alpha);
	}
	return texColor;
}

// nightSkyScene's gradient, and its stars
vec3 night_sky(vec3 d) {
	float h = clamp(d.y, -1.0, 1.0);
	vec3 zenith = vec3(0.004, 0.007, 0.02), horizon = vec3(0.022, 0.03, 0.055), below = vec3(0.006, 0.007, 0.01);
	vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, 0.45)) : mix(horizon, below, pow(-h, 0.35));
	vec2 uv = vec2(atan(d.z, d.x) / (2.0 * pi) + 0.5, acos(h) / pi);
	return c + texture(stars, uv).rgb; // (the stars drawn over it, unlit, as the points were)
}

// a sprite at 90 km in direction s, size m across: its texture coordinate for direction d (or outside 0..1)
vec2 sprite_uv(vec3 d, vec3 s, float size, float dist) {
	vec3 sx = normalize(cross(s, vec3(0.0, 1.0, 0.0))); // (facing you as a sprite, held upright)
	vec3 sy = cross(sx, s);
	float t = dot(d, s);
	if (t <= 0.0) return vec2(-1.0);
	vec3 p = d * (dist / t);
	return vec2(dot(p, sx), -dot(p, sy)) / size + 0.5;
}

void sky() {
	vec3 d = EYEDIR;
	vec3 col = night ? night_sky(d) : day_sky(d);
	if (overcast > 0.0) col = mix(col, lid_color, min(0.95, overcast * 0.95)); // the overcast: a grey lid over the sky (and the stars)
	if (AT_CUBEMAP_PASS) {
		// the light: the sky at environmentIntensity, and the hemisphere light (sky above, ground below: Three's
		// irradiance mix(ground, sky, 0.5 + 0.5 n.y), as radiance)
		COLOR = col * env_intensity + mix(hemi_ground, hemi_sky, 0.5 + 0.5 * d.y) * hemi_intensity / pi;
	} else {
		col *= bg_intensity;
		vec3 s = normalize(sun_position);
		// the sun's sprite (additive, 9 km across at 90 km): a white core and a faint warm glow round it
		if (dot(sun_sprite, sun_sprite) > 0.0) {
			vec2 uv = sprite_uv(d, s, 9000.0, 90000.0);
			if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
				float r = length(uv - 0.5) * 2.0;
				// (the canvas's radial gradient: white to 0.12, falling to rgba(255,240,215,0.12) at 0.2, to nothing at 1)
				vec4 g = r < 0.12 ? vec4(1.0) : r < 0.2 ? mix(vec4(1.0), vec4(1.0, 0.871, 0.680, 0.12), (r - 0.12) / 0.08) : r < 1.0 ? mix(vec4(1.0, 0.871, 0.680, 0.12), vec4(1.0, 0.791, 0.578, 0.0), (r - 0.2) / 0.8) : vec4(0.0);
				col += g.rgb * g.a * sun_sprite;
			}
		}
		if (moon_on) {
			vec2 gu = sprite_uv(d, s, 70000.0, 91000.0); // (its glow)
			if (gu.x >= 0.0 && gu.x <= 1.0 && gu.y >= 0.0 && gu.y <= 1.0) {
				vec4 g = texture(moon_glow_tex, gu);
				col += g.rgb * g.a * moon_glow_tint;
			}
			vec2 mu = sprite_uv(d, s, 6800.0, 90000.0); // (a big moon: the way it looms over the clouds at night)
			if (mu.x >= 0.0 && mu.x <= 1.0 && mu.y >= 0.0 && mu.y <= 1.0) {
				vec4 m = texture(moon_tex, mu);
				col = mix(col, m.rgb * moon_tint, m.a);
			}
		}
		COLOR = col;
	}
}
