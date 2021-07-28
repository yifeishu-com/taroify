import { ITouchEvent, View } from "@tarojs/components"
import classNames from "classnames"
import * as React from "react"
import {
  Children,
  cloneElement,
  CSSProperties,
  isValidElement,
  ReactElement,
  ReactNode,
  useCallback,
  useMemo,
  useRef,
} from "react"
import { prefixClassname } from "../styles"
import { getClientCoordinates, preventDefault, stopPropagation } from "../utils/dom/event"
import { addNumber, clamp } from "../utils/format/number"
import { addUnitPx } from "../utils/format/unit"
import { getBoundingClientRect } from "../utils/rect"
import { useTouch } from "../utils/touch"
import SliderThumb from "./slider-thumb"
import SliderContext from "./slider.context"

type SliderValue = number | [number, number] | number[]

enum SliderDragStatus {
  Start = "start",
  Dragging = "dragging",
  End = "end",
}

enum SliderOrientation {
  Horizontal = "horizontal",
  Vertical = "vertical",
}

type SliderOrientationString = "horizontal" | "vertical"

interface SliderChildren {
  thumb1: ReactNode
  thumb2: ReactNode
}

function useSliderChildren(children?: ReactNode, range?: boolean): SliderChildren {
  return useMemo(() => {
    const __children__: SliderChildren = {
      thumb1: undefined,
      thumb2: undefined,
    }

    Children.forEach(children, (child: ReactNode) => {
      if (!isValidElement(child)) {
        return
      }
      const element = child as ReactElement

      if (__children__.thumb1 === undefined) {
        __children__.thumb1 = element
      } else if (__children__.thumb2 === undefined) {
        __children__.thumb2 = element
      }
    })

    __children__.thumb1 = __children__.thumb1 ?? <SliderThumb />

    if (range) {
      __children__.thumb1 = cloneElement(__children__.thumb1 as ReactElement, {
        key: 0,
        index: 0,
      })

      __children__.thumb2 = __children__.thumb2 ?? <SliderThumb />
      __children__.thumb2 = cloneElement(__children__.thumb2 as ReactElement, {
        key: 1,
        index: 1,
      })
    } else {
      __children__.thumb1 = cloneElement(__children__.thumb1 as ReactElement, {
        index: undefined,
      })
    }

    return __children__
  }, [children, range])
}

interface SliderBaseProps {
  className?: string
  style?: CSSProperties
  step?: number
  min?: number
  max?: number
  size?: number
  activeColor?: string
  inactiveColor?: string
  orientation?: SliderOrientation | SliderOrientationString
  disabled?: boolean
  children?: ReactNode
}

export interface SliderSingleProps extends SliderBaseProps {
  range?: false
  value?: number

  onChange?(value: number): void
}

export interface SliderRangeProps extends SliderBaseProps {
  range?: boolean
  value?: [number, number] | number[]

  onChange?(value: [number, number] | number[]): void
}

function Slider(props: SliderSingleProps | SliderRangeProps) {
  const {
    className,
    style = {},
    value: valueProp = 0,
    min = 0,
    max = 100,
    step = 1,
    range = false,
    size,
    activeColor,
    inactiveColor,
    orientation = SliderOrientation.Horizontal,
    disabled = false,
    children,
    onChange,
  } = props

  const { thumb1, thumb2 } = useSliderChildren(children, range)

  const vertical = orientation === SliderOrientation.Vertical

  const rootRef = useRef<HTMLElement>()

  const dragStatusRef = useRef<SliderDragStatus>()

  const startValueRef = useRef<SliderValue>(0)

  const currentValueRef = useRef<SliderValue>(0)

  const buttonIndexRef = useRef<number>()

  const touch = useTouch()

  const scope = Number(max) - Number(min)

  const isRange = useCallback(
    (val: unknown): val is [number, number] => range && Array.isArray(val),
    [range],
  )

  // 计算选中条的长度百分比
  const calcMainAxis = useCallback(() => {
    if (isRange(valueProp)) {
      return `${((valueProp[1] - valueProp[0]) * 100) / scope}%`
    }
    return `${(((valueProp as number) - Number(min)) * 100) / scope}%`
  }, [isRange, min, scope, valueProp])

  // 计算选中条的开始位置的偏移量
  const calcOffset = useCallback(() => {
    if (isRange(valueProp)) {
      return `${((valueProp[0] - Number(min)) * 100) / scope}%`
    }
    return "0%"
  }, [isRange, min, scope, valueProp])

  const wrapperStyle = useMemo<CSSProperties>(() => {
    const crossAxis = vertical ? "width" : "height"
    return {
      ...style,
      background: inactiveColor ?? "",
      [crossAxis]: addUnitPx(size) ?? "",
    }
  }, [inactiveColor, size, style, vertical])

  const trackStyle = useMemo<CSSProperties>(() => {
    const mainAxis = vertical ? "height" : "width"
    return {
      [mainAxis]: calcMainAxis(),
      left: vertical ? "" : calcOffset(),
      top: vertical ? calcOffset() : "",
      background: activeColor ?? "",
      transition: dragStatusRef.current ? "none" : "",
    }
  }, [activeColor, calcMainAxis, calcOffset, vertical])

  const formatValue = (value: number) => {
    value = clamp(value, min, max)
    const diff = Math.round((value - min) / step) * step
    return addNumber(min, diff)
  }

  const isSameValue = (newValue: SliderValue, oldValue: SliderValue) =>
    JSON.stringify(newValue) === JSON.stringify(oldValue)

  const handleOverlap = (value: [number, number]) => {
    if (value[0] > value[1]) {
      return value.slice(0).reverse()
    }
    return value
  }

  const updateValue = (value: SliderValue) => {
    if (isRange(value)) {
      value = handleOverlap(value).map(formatValue) as [number, number]
    } else {
      value = formatValue(value as number)
    }

    if (!isSameValue(value, valueProp)) {
      onChange?.(value as any)
    }
  }

  const onClick = (event: ITouchEvent) => {
    stopPropagation(event)

    if (disabled) {
      return
    }

    getBoundingClientRect(rootRef).then((rect) => {
      const { clientX, clientY } = getClientCoordinates(event)

      const delta = vertical ? clientY - rect.top : clientX - rect.left
      const total = vertical ? rect.height : rect.width
      const newValue = Number(min) + (delta / total) * scope

      if (isRange(valueProp)) {
        const [left, right] = valueProp
        const middle = (left + right) / 2

        if (newValue <= middle) {
          updateValue([newValue, right])
        } else {
          updateValue([left, newValue])
        }
      } else {
        updateValue(newValue)
      }
    })
  }

  const onTouchStart = (event: ITouchEvent, index?: number) => {
    if (typeof index === "number") {
      // save index of current button
      buttonIndexRef.current = index
    }

    if (disabled) {
      return
    }

    touch.start(event)
    currentValueRef.current = valueProp

    if (isRange(currentValueRef.current)) {
      startValueRef.current = currentValueRef.current.map(formatValue) as [number, number]
    } else {
      startValueRef.current = formatValue(currentValueRef.current as number)
    }

    dragStatusRef.current = SliderDragStatus.Start
  }

  const onTouchMove = (event: ITouchEvent) => {
    if (disabled) {
      return
    }

    preventDefault(event, true)
    touch.move(event)
    dragStatusRef.current = SliderDragStatus.Dragging

    getBoundingClientRect(rootRef).then((rect) => {
      const delta = vertical ? touch.deltaY : touch.deltaX
      const total = vertical ? rect.height : rect.width
      const diff = (delta / total) * scope

      if (isRange(startValueRef.current)) {
        ;(currentValueRef.current as [number, number])[buttonIndexRef.current as number] =
          startValueRef.current[buttonIndexRef.current as number] + diff
      } else {
        currentValueRef.current = (startValueRef.current as number) + diff
      }
      updateValue(currentValueRef.current)
    })
  }

  const onTouchEnd = () => {
    if (disabled) {
      return
    }

    if (dragStatusRef.current === SliderDragStatus.Dragging) {
      updateValue(currentValueRef.current)
    }

    dragStatusRef.current = SliderDragStatus.End
  }

  return (
    <View
      ref={rootRef}
      className={classNames(
        classNames(prefixClassname("slider"), {
          [prefixClassname("slider--vertical")]: vertical,
          [prefixClassname("slider--disabled")]: disabled,
        }),
        className,
      )}
      style={wrapperStyle}
      onClick={onClick}
    >
      <SliderContext.Provider
        value={{
          onTouchStart,
          onTouchMove,
          onTouchEnd,
        }}
      >
        <View className={prefixClassname("slider__track")} style={trackStyle}>
          {range ? [thumb1, thumb2] : thumb1}
        </View>
      </SliderContext.Provider>
    </View>
  )
}

export default Slider